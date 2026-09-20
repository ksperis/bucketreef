import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import pytest
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'ops/release'))
from align_history_tags import alignment, apply_alignment
from history import documentation, load_catalog, notes
from publish_history import publish_history


@pytest.fixture
def history(tmp_path):
    def git(*args):
        return subprocess.check_output(['git','-c','user.name=Fixture','-c','user.email=fixture@example.invalid',*args],cwd=tmp_path,text=True).strip()
    git('init','--quiet')
    (tmp_path/'CHANGELOG.md').write_text('## 0.2.5 - 2026-09-20\n\n- Current.\n\n## 0.1.0 - 2026-01-06\n\n- Historical.\n')
    git('add','CHANGELOG.md');git('commit','-m','initial');git('tag','-a','v0.1.0','-m','annotated')
    old=git('rev-parse','HEAD')
    git('commit','--allow-empty','-m','current');git('tag','v0.2.5')
    new=git('rev-parse','HEAD')
    catalog={'schema':1,'latest':'0.2.5','releases':[
        dict(version='0.1.0',sha=old,date='2026-01-06',date_source='tag',confirmed=False,reconstructed=True),
        dict(version='0.2.5',sha=new,date='2026-09-20',date_source='changelog',confirmed=True,reconstructed=False)]}
    return tmp_path,catalog


class API:
    def __init__(self,platform,root,catalog):
        self.platform=platform;self.catalog=catalog;self.root=root;self.releases={};self.writes=[];self.fail=False
        entry=catalog['releases'][-1]
        self.releases['v0.2.5']=self.release(entry,notes(entry,platform,root))
    def release(self,entry,body):
        return dict(id=int(entry['version'].replace('.',''))+1,tag_name='v'+entry['version'],name='v'+entry['version'],body=body,description=body,draft=False,prerelease=False,commit={'id':entry['sha']},assets=[] if self.platform=='github' else {'links':[]},released_at=entry['date']+'T00:00:00Z')
    def request(self,path,method='GET',data=None,**kwargs):
        if path in {'releases/latest','releases/permalink/latest'}:return copy.deepcopy(self.releases['v0.2.5'])
        if path.startswith('git/ref/tags/'):
            entry=next(e for e in self.catalog['releases'] if 'v'+e['version']==path.split('/')[-1]);return {'object':{'type':'commit','sha':entry['sha']}}
        if method=='GET':return copy.deepcopy(self.releases.get(path.split('/')[-1]))
        if self.fail:raise RuntimeError('Interrupted GitLab publication')
        self.writes.append((method,path,copy.deepcopy(data)))
        if method=='POST':
            entry=next(e for e in self.catalog['releases'] if 'v'+e['version']==data['tag_name'])
            self.releases[data['tag_name']]=self.release(entry,data.get('body',data.get('description')))
            return copy.deepcopy(self.releases[data['tag_name']])
        release=next(r for r in self.releases.values() if str(r['id'])==path.split('/')[-1]) if self.platform=='github' else self.releases[path.split('/')[-1]]
        release.update(data);return copy.deepcopy(release)


def run(history,gh,gl,apply=True):
    root,catalog=history
    return publish_history(gh,gl,catalog,apply=apply,root=root,remote=str(root))


def test_dry_run_and_retry_preserve_latest_and_assets(history):
    root,catalog=history;gh=API('github',root,catalog);gl=API('gitlab',root,catalog)
    report,confirmed=run(history,gh,gl,False)
    assert confirmed is None and not gh.writes and not gl.writes
    assert [r['action'] for r in report].count('create')==2
    _,confirmed=run(history,gh,gl)
    assert all(e['confirmed'] for e in confirmed['releases'])
    assert gh.writes[0][2]['make_latest']=='false'
    assert gl.writes[0][2]['released_at']=='2026-01-06T00:00:00Z'
    assert 'assets' not in gh.writes[0][2] and 'assets' not in gl.writes[0][2]
    run(history,gh,gl)
    assert len(gh.writes)==len(gl.writes)==1


def test_partial_publication_resumes_without_rewriting_github(history):
    root,catalog=history;gh=API('github',root,catalog);gl=API('gitlab',root,catalog);gl.fail=True
    with pytest.raises(RuntimeError):run(history,gh,gl)
    assert len(gh.writes)==1
    gl.fail=False;run(history,gh,gl)
    assert len(gh.writes)==len(gl.writes)==1


@pytest.mark.parametrize('platform',['github','gitlab'])
def test_conflicts_stop_all_writes(history,platform):
    root,catalog=history;gh=API('github',root,catalog);gl=API('gitlab',root,catalog)
    api=gh if platform=='github' else gl
    api.releases['v0.1.0']=api.release(catalog['releases'][0],'Existing human notes')
    with pytest.raises(ValueError,match='refusing'):run(history,gh,gl)
    assert not gh.writes and not gl.writes


@pytest.mark.parametrize('platform',['github','gitlab'])
def test_only_empty_notes_are_completed_preserving_assets(history,platform):
    root,catalog=history;gh=API('github',root,catalog);gl=API('gitlab',root,catalog)
    api=gh if platform=='github' else gl
    release=api.release(catalog['releases'][0],' ');release['assets']={'fixture':'unchanged'};api.releases['v0.1.0']=release
    run(history,gh,gl)
    assert api.releases['v0.1.0']['assets']=={'fixture':'unchanged'}
    assert api.writes[0][0]==('PATCH' if platform=='github' else 'PUT')


def test_latest_mismatch_refuses_publication(history):
    root,catalog=history;gh=API('github',root,catalog);gl=API('gitlab',root,catalog)
    gh.releases['v0.2.5']['tag_name']='v0.2.6'
    with pytest.raises(ValueError,match='Latest'):run(history,gh,gl)
    assert not gh.writes and not gl.writes


def test_catalog_resolves_annotated_and_lightweight_tags_and_generates_offline(history):
    root,catalog=history;p=root/'history.json';p.write_text(json.dumps(catalog))
    assert load_catalog(p,root)==catalog
    page=documentation(catalog,root)
    assert '## 0.2.5 {#release-0-2-5}' in page and '## 0.1.0' not in page
    catalog['releases'][0]['confirmed']=True
    page=documentation(catalog,root)
    assert '## 0.1.0 {#release-0-1-0}' in page
    assert 'Historical.' in page and 'Reconstructed' in page
    assert page==documentation(catalog,root)
    assert 'compare/v0.1.0...v0.2.5' in page
    assert '**Source:**' in notes(catalog['releases'][0],'github',root)


@pytest.mark.parametrize('bad',['missing','duplicate','empty','sha'])
def test_invalid_catalog_or_changelog_refused(history,bad):
    root,catalog=history
    if bad=='sha':catalog['releases'][0]['sha']='a'*40
    elif bad=='duplicate':(root/'CHANGELOG.md').write_text((root/'CHANGELOG.md').read_text()+'\n## 0.1.0\n- Duplicate\n')
    elif bad=='empty':(root/'CHANGELOG.md').write_text('## 0.1.0\n\n## 0.2.5\n- Current\n')
    else:(root/'CHANGELOG.md').write_text('## 0.2.5\n- Current\n')
    p=root/'history.json';p.write_text(json.dumps(catalog))
    with pytest.raises(ValueError):load_catalog(p,root)


def test_alignment_only_allows_named_old_gitlab_sha_and_skips_ci(monkeypatch):
    entry={'version':'0.1.8','sha':'b'*40,'previous_gitlab_sha':'a'*40}
    catalog={'releases':[entry]};refs={'refs/tags/v0.1.8':'a'*40}
    actions=alignment(catalog,refs,'gitlab')
    with pytest.raises(ValueError):alignment(catalog,refs,'github')
    with pytest.raises(ValueError):alignment(catalog,{'refs/tags/v0.1.8':'c'*40},'gitlab')
    calls=[];monkeypatch.setattr(subprocess,'run',lambda args,**kw:calls.append(args))
    apply_alignment(ROOT,'gitlab','gitlab',actions)
    assert '--atomic' in calls[0] and 'ci.skip' in calls[0]
    assert '--force-with-lease=refs/tags/v0.1.8:'+'a'*40 in calls[0]
    assert alignment(catalog,{},'gitlab')[0]['expected']==''
    assert not alignment(catalog,{'refs/tags/v0.1.8':'b'*40},'gitlab')


def test_realign_notice_does_not_claim_images_rebuilt(history):
    root,catalog=history;entry=catalog['releases'][0];entry['previous_gitlab_sha']='a'*40
    assert 'were not rebuilt' in notes(entry,'github',root)
    assert 'a'*40 in notes(entry,'gitlab',root)


def test_checked_in_documentation_matches_confirmed_catalog():
    catalog=load_catalog(ROOT/'ops/release/history.json')
    assert (ROOT/'doc/docs/releases.md').read_text()==documentation(catalog)
