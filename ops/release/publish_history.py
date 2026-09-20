#!/usr/bin/env python3
"""Preview or publish historical release notes, never release artifacts or tags."""
from __future__ import annotations
import argparse
import copy
import json
import os
from pathlib import Path
import sys
from history import ROOT, GITLAB, load_catalog, notes
from publish_github_release import GitHub, resolve_tag
from publish_gitlab_release import GitLab, resolve_git_tag


def action(release, expected, platform, sha):
    if release is None:
        return 'create'
    if platform == 'github' and (release.get('draft') or release.get('prerelease')):
        raise ValueError('Existing historical release is a draft or prerelease')
    if platform == 'gitlab' and release['commit']['id'] != sha:
        raise ValueError('Existing GitLab release commit differs')
    body=release.get('body' if platform=='github' else 'description') or ''
    if not body.strip():
        return 'complete'
    if body != expected:
        raise ValueError('Existing historical release notes differ; refusing to overwrite')
    return 'keep'


def latest(gh, gl):
    return (gh.request('releases/latest')['tag_name'], gl.request('releases/permalink/latest')['tag_name'])


def publish_history(gh, gl, catalog, *, apply=False, root=ROOT, remote='origin'):
    expected_latest='v'+catalog['latest']
    if latest(gh,gl)!=(expected_latest,expected_latest):
        raise ValueError('Latest release differs from the catalog; refusing publication')
    # Inventory all tags/releases and detect every conflict before the first write.
    inventory=[]
    for entry in catalog['releases']:
        v=entry['version']; tag='v'+v
        if resolve_tag(gh,tag)!=entry['sha'] or resolve_git_tag(v,root=root,remote=remote)!=entry['sha']:
            raise ValueError(f'Remote tag differs from catalog: {tag}')
        for platform,api in [('github',gh),('gitlab',gl)]:
            path=f'releases/tags/{tag}' if platform=='github' else f'releases/{tag}'
            release=api.request(path,missing_ok=True)
            expected=notes(entry,platform,root)
            operation=action(release,expected,platform,entry['sha'])
            if v==catalog['latest'] and operation!='keep':
                raise ValueError('Latest release cannot be changed by historical publication')
            inventory.append((entry,platform,api,path,release,expected,operation))
    report=[{'version':e['version'],'platform':p,'action':op} for e,p,_,_,_,_,op in inventory]
    if not apply:
        return report, None
    for entry,platform,api,path,old,expected,operation in inventory:
        tag='v'+entry['version']
        # Re-read before a write so a concurrent manual edit is never overwritten.
        current=api.request(path,missing_ok=True)
        operation=action(current,expected,platform,entry['sha'])
        if operation != 'keep' and (resolve_tag(gh,tag)!=entry['sha'] or resolve_git_tag(entry['version'],root=root,remote=remote)!=entry['sha']):
            raise ValueError('Release tag changed before publication')
        if operation=='create':
            data={'tag_name':tag,'name':tag}
            if platform=='github':
                data.update(target_commitish=entry['sha'],body=expected,draft=False,prerelease=False,make_latest='false')
            else:
                data.update(description=expected,released_at=entry['date']+'T00:00:00Z')
            api.request('releases',method='POST',data=data)
        elif operation=='complete':
            if platform=='github':
                api.request(f"releases/{current['id']}",method='PATCH',data={'body':expected,'make_latest':'false'})
            else:
                api.request(path,method='PUT',data={'description':expected,'released_at':entry['date']+'T00:00:00Z'})
        verified=api.request(path)
        if action(verified,expected,platform,entry['sha'])!='keep':
            raise ValueError('Release could not be verified after publication')
        if current and verified.get('assets')!=current.get('assets'):
            raise ValueError('Existing release assets changed')
    if latest(gh,gl)!=(expected_latest,expected_latest):
        raise ValueError('Latest release changed during publication')
    confirmed=copy.deepcopy(catalog)
    for entry in confirmed['releases']:
        entry['confirmed']=True
    return report,confirmed


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply',action='store_true')
    parser.add_argument('--catalog',type=Path,default=ROOT/'ops/release/history.json')
    parser.add_argument('--output',type=Path,default=ROOT/'dist/release-history')
    args=parser.parse_args()
    try:
        catalog=load_catalog(args.catalog)
        gh=GitHub(os.environ.get('GITHUB_RELEASE_TOKEN',''))
        gl=GitLab(os.environ['CI_API_V4_URL'],os.environ['CI_PROJECT_ID'],os.environ['CI_JOB_TOKEN'])
        report,confirmed=publish_history(gh,gl,catalog,apply=args.apply)
        args.output.mkdir(parents=True,exist_ok=True)
        (args.output/'plan.json').write_text(json.dumps(report,indent=2)+'\n')
        if confirmed:
            (args.output/'confirmed.json').write_text(json.dumps(confirmed,indent=2)+'\n')
        print(json.dumps(report,indent=2))
    except (ValueError,RuntimeError,KeyError,OSError) as error:
        print(f'Historical publication failed: {error}',file=sys.stderr)
        sys.exit(1)
