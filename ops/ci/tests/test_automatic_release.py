import copy
import json
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace

import pytest

sys.path[:0] = [str(Path(__file__).resolve().parents[1]), str(Path(__file__).resolve().parents[2] / 'release')]
import distribution as dist
import events
import gitlab_api
import installation_evidence as installation
from plan import release_transition
from test_distribution import prepared, SHA, IMAGE


def version_repository(tmp_path):
    def git(*args):
        return subprocess.check_output(['git','-c','user.name=Fixture','-c','user.email=fixture@example.invalid',*args], cwd=tmp_path, text=True).strip()
    git('init','-q')
    def commit(version, dependency='1'):
        files = {
            'frontend/package.json':json.dumps({'version':version,'dependencies':{'x':dependency}}),
            'frontend/package-lock.json':json.dumps({'version':version,'packages':{'':{'version':version}},'dependencies':{'x':dependency}}),
            'deploy/helm/bucketreef/Chart.yaml':f'version: {version}\nappVersion: {version}\n',
            'deploy/bundle/.env.example':f'BUCKETREEF_TAG={version}\n',
            'CHANGELOG.md':f'## {version} - 2026-09-29\n\n- Fixture changes.\n',
        }
        for name, text in files.items():
            path = tmp_path / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text)
        git('add','.')
        git('commit','-qm','fixture')
        return git('rev-parse','HEAD')
    return commit


def test_only_true_version_increase_authorizes_release(tmp_path):
    commit = version_repository(tmp_path)
    first = commit('0.2.10')
    dependency = commit('0.2.10','2')
    assert release_transition(first, dependency, root=tmp_path) is None
    head = commit('0.2.11','2')
    assert release_transition(dependency, head, root=tmp_path)['version'] == '0.2.11'
    for base in (None, '0'*40, 'f'*40):
        assert release_transition(base, head, root=tmp_path) is None
    back = commit('0.2.9','2')
    with pytest.raises(ValueError, match='increase'):
        release_transition(head, back, root=tmp_path)


def test_mismatched_metadata_and_missing_changelog_cannot_publish(tmp_path):
    commit = version_repository(tmp_path)
    before = commit('0.2.10')
    head = commit('0.2.11')
    (tmp_path/'deploy/bundle/.env.example').write_text('BUCKETREEF_TAG=0.2.10\n')
    with pytest.raises(ValueError, match='mismatch'):
        release_transition(before, head, root=tmp_path)
    (tmp_path/'deploy/bundle/.env.example').write_text('BUCKETREEF_TAG=0.2.11\n')
    (tmp_path/'CHANGELOG.md').write_text('No release section')
    with pytest.raises(ValueError): release_transition(before, head, root=tmp_path)


@pytest.mark.parametrize('comparison,transition,profile', [(None,None,'qualify'), ([],None,'integration'), (['frontend/package.json'],{'version':'0.2.11'},'prepare-release')])
def test_push_uses_event_comparison_not_impact_baseline(monkeypatch, comparison, transition, profile):
    monkeypatch.setattr(gitlab_api,'latest_baseline',lambda *args:'a'*40)
    monkeypatch.setattr(events,'git',lambda *args:SHA)
    monkeypatch.setattr(events,'changes',lambda base,head: comparison if base == 'c'*40 else [])
    monkeypatch.setattr(events,'release_transition',lambda before,head: transition)
    plan = events.gitlab_plan({'CI_COMMIT_BRANCH':'main','CI_PIPELINE_SOURCE':'push','CI_COMMIT_REF_PROTECTED':'true',
                              'CI_COMMIT_SHA':SHA,'CI_COMMIT_BEFORE_SHA':'c'*40,'CI_PIPELINE_ID':'19'}, api=object())
    assert plan['profile'] == profile


def test_arm64_failure_creates_no_stable_reference(monkeypatch, tmp_path):
    api, jobs = prepared(monkeypatch, tmp_path)
    dist.write('distribution-ready.json',dist.ready(api))
    next(j for j in jobs if j['name']=='release-compose-smoke: [arm64]')['status']='failed'
    monkeypatch.setattr(dist,'GitLabAPI',lambda:api)
    monkeypatch.setattr(dist,'promote_stable',lambda *args:pytest.fail('Stable mutation before ARM64 passed'))
    monkeypatch.setattr(dist,'ensure_github_tag',lambda *args:pytest.fail('Premature stable tag'))
    with pytest.raises(ValueError,match='Unsuccessful'): dist.finalize()


@pytest.mark.parametrize('damage',['arch','manifest','phase','sha','job','candidate'])
def test_installation_proofs_cannot_be_substituted(monkeypatch,tmp_path,damage):
    api, _ = prepared(monkeypatch,tmp_path)
    path='installation-receipts/compose-arm64.json'
    proof=dist.read(path)
    if damage=='arch': proof['checkpoints']['compose']['backend']['arch']='amd64'
    elif damage=='manifest': proof['checkpoints']['compose']['backend']['manifest']=IMAGE['platforms']['amd64']
    elif damage=='phase': proof['checkpoints'].pop('compose-restart')
    elif damage=='sha': proof['sha']='f'*40
    elif damage=='job': proof['job_id']=123456
    elif damage=='candidate': proof['candidate_sha256']='f'*64
    dist.write(path,proof)
    with pytest.raises(ValueError,match='Installation'): dist.ready(api)


def test_interrupted_stable_copy_reuses_identical_images_and_refuses_conflicts(monkeypatch,tmp_path):
    api, _=prepared(monkeypatch,tmp_path)
    proof=dist.ready(api)
    remote={}
    copies=[]
    fail=[True]
    def copy_image(source,target,**kwargs):
        image=proof['images'][target.split('bucketreef-')[1].split(':')[0]]
        if target in remote and remote[target]!=image: raise ValueError('immutable conflict')
        if target not in remote:
            remote[target]=copy.deepcopy(image)
            copies.append(target)
        if target.endswith('frontend:1.2.3') and fail[0]: raise RuntimeError('Interrupted promotion')
    monkeypatch.setattr(dist,'copy_image',copy_image)
    monkeypatch.setattr(dist,'credentials',lambda *args:'fixture')
    monkeypatch.setattr(dist.bundle_registry,'publish',lambda *args:{'files':{}})
    monkeypatch.setattr(dist.bundle_registry,'download',lambda *args,**kwargs:None)
    monkeypatch.setattr(dist.subprocess,'run',lambda *args,**kwargs:None)
    with pytest.raises(RuntimeError,match='Interrupted'): dist.promote_stable(proof)
    assert len(copies)==2
    fail[0]=False
    dist.promote_stable(proof)
    assert len(copies)==3
    remote['ghcr.io/ksperis/bucketreef-backend:1.2.3']['digest']='sha256:'+'f'*64
    with pytest.raises(ValueError,match='conflict'): dist.promote_stable(proof)
    assert len(copies)==3


def test_candidate_distribution_never_writes_stable_tags(monkeypatch,tmp_path):
    prepared(monkeypatch,tmp_path)
    monkeypatch.setenv('CI_REGISTRY_IMAGE','internal.example/project')
    monkeypatch.setattr(dist,'credentials',lambda *args:'fixture')
    calls=[]
    monkeypatch.setattr(dist,'copy_image',lambda source,target,**kwargs:calls.append(target))
    dist.candidates()
    assert len(calls)==3
    assert all(target.endswith(f':candidate-{SHA}-20') for target in calls)


@pytest.mark.parametrize('kind',[False,True])
def test_installation_pulls_actual_platform_digests_and_rechecks_candidate_bytes(monkeypatch,tmp_path,kind):
    prepared(monkeypatch,tmp_path)
    monkeypatch.setenv('IMAGE_ARCH','arm64')
    Path('public-candidate').mkdir()
    for name in dist.read('candidate-inventory.json')['artifact']['files']:
        Path('public-candidate',name).write_text('fixture')
    calls=[]
    def command(*args,**kwargs):
        if args[:2]==('docker','pull'):
            assert json.loads(Path(kwargs['env']['DOCKER_CONFIG'],'config.json').read_text())=={'auths':{}}
        calls.append(args)
    monkeypatch.setattr(installation,'command',command)
    arch='amd64' if kind else 'arm64'
    monkeypatch.setattr(installation,'inspect_image',lambda ref:{'id':IMAGE['digest'],'arch':arch,'os':'linux'})
    installation.preload(kind=kind)
    pulls=[args for args in calls if args[:2]==('docker','pull')]
    assert len(pulls)==(2 if kind else 3)
    assert all(args[-1].endswith('@'+IMAGE['platforms'][arch]) for args in pulls)
    calls.clear()
    Path('public-candidate/bucketreef-deploy.tar.gz').write_text('substituted')
    with pytest.raises(ValueError,match='input differs'): installation.preload(kind=kind)
    assert not calls


def test_diagnostics_exclude_generated_secrets_and_bootstrap_urls():
    secret='generated-test-secret'
    container={'Id':'abc','Image':'sha256:'+'1'*64,'Name':'fixture', 'Config':{'Env':[secret]},
               'State':{'Status':'running','Error':secret,'Health':{'Status':'healthy','Log':[{'ExitCode':0,'Output':f'http://localhost/setup/first-admin#token={secret}'}]}}}
    result=json.dumps(installation.safe_container(container))
    assert secret not in result and 'token=' not in result and 'Env' not in result
    assert 'healthy' in result and 'ExitCode' in result


def test_smoke_budgets_and_public_defaults_are_explicit():
    from plan import ROOT, select
    from render_gitlab import render
    config=render({**select('prepare-release',[]),'sha':SHA,'parent_id':19})
    for job in ('release-quickstart-smoke', 'release-compose-smoke'):
        assert config[job]['extends']=='.release-deploy-smoke'
        assert config['.release-deploy-smoke']['timeout']=='45m'
        assert '40m' in '\n'.join(config['.release-deploy-smoke']['script'])
    script=(ROOT/'ops/ci/deploy-bundle-smoke.sh').read_text()
    assert 'health_retries=60' in script and 'compose_wait_timeout=600' in script
    assert 'QUICKSTART_HEALTH_TIMEOUT_SECONDS' in script
    assert script.count('public-candidate/bucketreef-deploy.tar.gz') == 1
    assert 'bucketreef-quickstart.tar.gz' not in script and 'bucketreef-compose.tar.gz' not in script
    assert '--profile operations' not in script
    assert script.index('installation_evidence.py diagnostics') < script.index('down --volumes')
    compose=(ROOT/'deploy/bundle/compose.yaml').read_text()
    assert compose.count('${BUCKETREEF_HEALTHCHECK_RETRIES:-24}')==2


@pytest.mark.parametrize('profile',['qualify','prepare-release'])
def test_scheduled_security_scan_accepts_both_complete_qualification_profiles(monkeypatch,tmp_path,profile):
    import scan_published
    api,_=prepared(monkeypatch,tmp_path)
    record=dist.read('qualification.json')
    record['plan']['profile']=profile
    public=SimpleNamespace(request=lambda path:{'draft':False,'prerelease':False,'tag_name':'v1.2.3'})
    monkeypatch.setattr(scan_published,'PublicGitHub',lambda:public)
    monkeypatch.setattr(scan_published,'resolve_tag',lambda *args:SHA)
    monkeypatch.setattr(scan_published,'GitLabAPI',lambda:api)
    monkeypatch.setattr(scan_published,'completed_records',lambda *args:iter([record]))
    calls=[]
    monkeypatch.setattr(scan_published.subprocess,'run',lambda args,**kwargs:calls.append(kwargs['env']))
    scan_published.scan()
    assert len(calls)==6
    assert all(call['SCAN_KIND']=='scheduled' and call['SOURCE_IMAGE'].endswith('@'+IMAGE['digest']) for call in calls)
