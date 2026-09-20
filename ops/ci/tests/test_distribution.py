import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'release'))
import distribution as dist
import bundle_registry
import qualification
import registry
from gitlab_api import expected_names
from plan import COMPONENTS, PUBLIC, select
from render_gitlab import render

SHA = 'a' * 40
DIGEST = 'sha256:' + 'b' * 64
IMAGE = {'digest': DIGEST, 'platforms': {'amd64': 'sha256:'+'c'*64, 'arm64': 'sha256:'+'d'*64}}


def qualified():
    plan = {**select('qualify', []), 'sha': SHA}
    jobs = {name: index for index, name in enumerate(expected_names(plan['jobs']), 1)}
    record = {'schema': 1, 'sha': SHA, 'ref': 'main', 'pipeline_id': 10, 'parent_id': 9,
              'plan': plan, 'jobs': jobs, 'images': {c: copy.deepcopy(IMAGE) for c in COMPONENTS}, 'scans': {}}
    for component in COMPONENTS:
        for arch in ('amd64', 'arm64'):
            record['scans'][f'{component}-{arch}'] = {
                'sha': SHA, 'pipeline_id': 10, 'job_id': jobs[f'{component}-image-vuln-scan: [{arch}]'],
                'arch': arch, 'image': f'registry.example/{component}@{DIGEST}',
                'created_at': '2026-09-20T00:00:00Z', 'tool': 'Trivy fixture'}
    return record


@pytest.mark.parametrize('damage', ['sha', 'profile', 'ceph', 'image', 'arch', 'scan', 'scan-job', 'scan-digest'])
def test_qualification_refuses_incomplete_or_mismatched_proofs(damage):
    record = qualified()
    qualification.validate(record, SHA)
    if damage == 'sha': record['sha'] = 'e'*40
    if damage == 'profile': record['plan']['profile'] = 'integration'
    if damage == 'ceph': record['plan']['jobs'].remove('ceph-functional-tests')
    if damage == 'image': record['images'].pop('scheduler')
    if damage == 'arch': record['images']['backend']['platforms'].pop('arm64')
    if damage == 'scan': record['scans'].pop('backend-arm64')
    if damage == 'scan-job': record['scans']['backend-arm64']['job_id'] = 999
    if damage == 'scan-digest': record['scans']['backend-arm64']['image'] = 'other@sha256:'+'e'*64
    with pytest.raises(ValueError): qualification.validate(record, SHA)


def test_qualification_requires_completed_pipeline_and_unchanged_registry(monkeypatch):
    monkeypatch.setattr(qualification, 'completed_records', lambda *args: iter([]))
    with pytest.raises(ValueError, match='No successful'): qualification.find(None, SHA)
    monkeypatch.setattr(qualification, 'completed_records', lambda *args: iter([qualified()]))
    monkeypatch.setenv('CI_REGISTRY_IMAGE', 'registry.example')
    monkeypatch.setattr(qualification, 'credentials', lambda: 'fixture')
    monkeypatch.setattr(qualification, 'inspect', lambda *args, **kwargs: IMAGE)
    assert qualification.find(None, SHA)['sha'] == SHA
    monkeypatch.setattr(qualification, 'inspect', lambda *args, **kwargs: {**IMAGE, 'digest': 'sha256:'+'f'*64})
    with pytest.raises(ValueError, match='differ'): qualification.find(None, SHA)


@pytest.mark.parametrize('stage', expected_names(dist.REQUIRED))
@pytest.mark.parametrize('status', ['failed', 'canceled', 'skipped', 'missing'])
def test_global_distribution_gate_requires_every_job_and_matrix_member(monkeypatch, stage, status):
    monkeypatch.setenv('CI_PIPELINE_ID', '20')
    monkeypatch.setenv('RELEASE_VERSION', '1.2.3')
    monkeypatch.setattr(dist, 'source_record', qualified)
    jobs = [{'id': i, 'name': name, 'status': 'success', 'commit': {'id': SHA}} for i, name in enumerate(expected_names(dist.REQUIRED))]
    jobs = [j for j in jobs if status != 'missing' or j['name'] != stage]
    for job in jobs:
        if job['name'] == stage: job['status'] = status
    api = SimpleNamespace(jobs=lambda _: jobs, get=lambda _: {'sha':SHA,'ref':'v1.2.3','source':'parent_pipeline'})
    monkeypatch.setattr(dist, 'verify_public', lambda: pytest.fail('Registry checks must follow the job gate'))
    with pytest.raises(ValueError): dist.ready(api)


@pytest.mark.parametrize('current,published,expected', [
    ('1.2.3', ['1.2.3','1.2.10','1.3.0'], []),
    ('1.2.10', ['1.2.3','1.2.10','1.3.0'], ['1.2']),
    ('1.3.0', ['1.3.0','1.2.10'], ['1.3','latest']),
    ('2.0.0', ['2.0.0','10.0.0'], ['2.0']),
])
def test_serialized_alias_decisions_are_numeric_and_never_regress(current, published, expected):
    assert dist.aliases(current, published) == expected
    with pytest.raises(ValueError): dist.aliases('9.9.9', published)


def test_finalization_rechecks_artifacts_before_any_public_mutation(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    dist.write('distribution-ready.json', {'files': {'bundle': 'original'}})
    monkeypatch.setattr(dist, 'GitLabAPI', lambda: None)
    monkeypatch.setattr(dist, 'ready', lambda _: {'files': {'bundle': 'changed'}})
    monkeypatch.setattr(dist, 'github', lambda **kwargs: pytest.fail('Premature GitHub publication'))
    with pytest.raises(ValueError, match='stale'): dist.finalize()


def test_interrupted_finalization_can_resume_and_older_retries_do_not_move_aliases(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    dist.write('distribution-ready.json', {'fixture': True})
    for name, value in {'RELEASE_VERSION':'1.2.3', 'CI_COMMIT_SHA':SHA, 'GITHUB_RELEASE_TOKEN':'fixture',
                        'CI_API_V4_URL':'fixture','CI_PROJECT_ID':'1','CI_JOB_TOKEN':'fixture'}.items():
        monkeypatch.setenv(name, value)
    Path('dist/release-notes').mkdir(parents=True)
    Path('dist/release-notes/gitlab.md').write_text('Notes')
    monkeypatch.setattr(dist, 'GitLabAPI', lambda: None)
    monkeypatch.setattr(dist, 'ready', lambda _: {'fixture':True})
    calls = []
    monkeypatch.setattr(dist, 'github', lambda **kwargs: calls.append('github'))
    def fail(*args):
        calls.append('gitlab')
        raise RuntimeError('Interrupted between services')
    monkeypatch.setattr(dist, 'publish_gitlab', fail)
    monkeypatch.setattr(dist, 'copy_image', lambda *args, **kwargs: calls.append('alias'))
    with pytest.raises(RuntimeError): dist.finalize()
    assert calls == ['github', 'gitlab']
    monkeypatch.setattr(dist, 'publish_gitlab', lambda *args: calls.append('gitlab'))
    monkeypatch.setattr(dist, 'published_versions', lambda *args: ['1.2.3','1.2.10'])
    dist.finalize()
    assert calls == ['github','gitlab','github','gitlab']


def test_child_graphs_cover_every_profile_without_optional_or_dangling_edges():
    for profile in ('qualify', 'release', 'docs', 'recover-release', 'security', 'regression', 'secrets-history'):
        config = render({**select(profile, []), 'sha': SHA, 'parent_id': 9})
        for name, job in config.items():
            if name.startswith('.') or not isinstance(job, dict): continue
            for need in job.get('needs', []):
                assert need['job'] in config, (profile,name,need)
                assert not need.get('optional')
        if profile == 'qualify':
            assert set(PUBLIC) <= set(config)
            assert 'ceph-functional-tests' in config
            assert config['integration-ready']['artifacts']['expire_in'] == 'never'
        if profile == 'release':
            assert not any(name.startswith('build-') for name in config)
        if profile == 'recover-release':
            assert 'finalize-release' not in config


def test_registry_copy_preserves_all_manifests_and_refuses_conflicts(monkeypatch):
    calls = []
    exists = [None]
    monkeypatch.setattr(registry, 'inspect', lambda ref, **kw: IMAGE if ref == 'source' else exists[0])
    def copy(args, **kwargs):
        calls.append(args)
        exists[0] = IMAGE
        return SimpleNamespace(returncode=0)
    monkeypatch.setattr(registry.subprocess, 'run', copy)
    registry.copy_image('source', 'target', src_creds='source-fixture', dest_creds='dest-fixture')
    assert '--all' in calls[0] and '--preserve-digests' in calls[0]
    registry.copy_image('source', 'target', src_creds='source-fixture', dest_creds='dest-fixture')
    assert len(calls) == 1
    exists[0] = {**IMAGE, 'digest':'sha256:'+'f'*64}
    with pytest.raises(ValueError, match='immutable'):
        registry.copy_image('source', 'target', src_creds='source-fixture', dest_creds='dest-fixture')
    assert len(calls) == 1


def test_registry_denied_is_not_a_missing_version(monkeypatch):
    monkeypatch.setattr(registry.subprocess, 'run', lambda *a, **kw: SimpleNamespace(returncode=1, stderr=b'401 unauthorized SECRET'))
    with pytest.raises(RuntimeError, match='withheld') as error:
        registry.inspect('image:version', missing_ok=True)
    assert 'SECRET' not in str(error.value)


def test_registry_validates_both_platforms_and_the_exact_index(monkeypatch):
    index = {'manifests':[{'digest': d, 'platform': {'os':'linux', 'architecture':a}} for a,d in IMAGE['platforms'].items()]}
    raw = json.dumps(index).encode()
    monkeypatch.setattr(registry.subprocess, 'run', lambda *a, **kw: SimpleNamespace(returncode=0,stdout=raw))
    digest = 'sha256:'+hashlib.sha256(raw).hexdigest()
    assert registry.inspect('image@'+digest)['platforms'] == IMAGE['platforms']
    with pytest.raises(ValueError): registry.inspect('image@'+DIGEST)
    index['manifests'].pop()
    raw = json.dumps(index).encode()
    with pytest.raises(ValueError): registry.inspect('image:version')


def test_anonymous_bundles_are_checked_against_exact_bytes(monkeypatch, tmp_path):
    record = {'sha':SHA, 'version':'1.2.3', 'digest':DIGEST, 'files':{name:hashlib.sha256(b'fixture').hexdigest() for name in bundle_registry.ASSETS}}
    def run(args, **kwargs):
        auth = Path(args[args.index('--registry-config')+1])
        assert json.loads(auth.read_text()) == {'auths':{}}
        if args[0] == 'resolve': return DIGEST.encode()
        for name in bundle_registry.ASSETS: (tmp_path/name).write_bytes(b'fixture')
    monkeypatch.setattr(bundle_registry, 'run', run)
    bundle_registry.download(record, tmp_path, version='1.2.3', sha=SHA)
    record['files'][bundle_registry.ASSETS[0]] = 'wrong'
    with pytest.raises(ValueError, match='differs'): bundle_registry.download(record, tmp_path, version='1.2.3', sha=SHA)
