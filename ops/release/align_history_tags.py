#!/usr/bin/env python3
"""Preview the explicitly catalogued historical tag alignment; opt in to apply."""
import argparse
import json
import subprocess
from history import ROOT, git, load_catalog


def remote_refs(root, remote):
    raw=git(root,'ls-remote','--tags',remote)
    refs={line.split()[1]:line.split()[0] for line in raw.splitlines()}
    return refs


def alignment(catalog, refs, platform):
    actions=[]
    for entry in catalog['releases']:
        ref='refs/tags/v'+entry['version']
        current=refs.get(ref)
        resolved=refs.get(ref+'^{}',current)
        if resolved==entry['sha']:
            continue
        if current and not (platform=='gitlab' and current==entry.get('previous_gitlab_sha')):
            raise ValueError(f'Unapproved remote tag divergence: {ref}')
        actions.append({'ref':ref,'expected':current or '', 'sha':entry['sha']})
    return actions


def apply_alignment(root, remote, platform, actions):
    if not actions:return
    args=['git','push','--atomic']
    args += [f"--force-with-lease={a['ref']}:{a['expected']}" for a in actions]
    if platform=='gitlab':args += ['-o','ci.skip']
    args += [remote] + [f"{a['ref']}:{a['ref']}" for a in actions]
    subprocess.run(args,cwd=root,check=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply',action='store_true')
    args=parser.parse_args()
    catalog=load_catalog(ROOT/'ops/release/history.json')
    plans={p:alignment(catalog,remote_refs(ROOT,p),p) for p in ('github','gitlab')}
    print(json.dumps(plans,indent=2))
    if args.apply:
        for platform,actions in plans.items():
            apply_alignment(ROOT,platform,platform,actions)
            if alignment(catalog,remote_refs(ROOT,platform),platform):
                raise SystemExit('Remote tag alignment could not be verified')
