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
import bootstrap_bundle_registry as bootstrap_registry
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


def prepared(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    for name, value in {'RELEASE_VERSION':'1.2.3', 'CI_COMMIT_SHA':SHA, 'CI_PIPELINE_ID':'20', 'CI_JOB_ID':'999',
                        'GITHUB_RELEASE_TOKEN':'fixture', 'CI_API_V4_URL':'fixture', 'CI_PROJECT_ID':'1', 'CI_JOB_TOKEN':'fixture'}.items():
        monkeypatch.setenv(name, value)
    monkeypatch.delenv('RELEASE_SOURCE_SHA', raising=False)
    record = qualified()
    plan = {**select('prepare-release', []), 'sha':SHA, 'parent_id':19}
    jobs = [{'id':i, 'name':name, 'status':'success', 'commit':{'id':SHA}}
            for i,name in enumerate(sorted(set(expected_names([*plan['jobs'], *dist.REQUIRED]))), 1)]
    ids = {job['name']:job['id'] for job in jobs}
    record.update(plan=plan, pipeline_id=20, parent_id=19, jobs={name:ids[name] for name in expected_names(plan['jobs'])})
    for key, scan in record['scans'].items():
        component, arch = key.rsplit('-',1)
        scan.update(pipeline_id=20, job_id=ids[f'{component}-image-vuln-scan: [{arch}]'])
    dist.write('ci-plan.json', plan)
    dist.write('qualification.json', record)
    for path in dist.files():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('fixture')
    inventory = {'schema':2, 'sha':SHA, 'version':'1.2.3', 'pipeline_id':20, 'job_id':ids['publish-candidate-artifacts'],
                 'tag':f'candidate-{SHA}-20', 'images':record['images'], 'qualification_sha256':dist.digest(record),
                 'files':dist.fingerprints(), 'artifact':{'digest':DIGEST, 'sha':SHA, 'version':f'candidate-{SHA}-20',
                 'files':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in dist.files()}}}
    dist.write('candidate-inventory.json', inventory)
    Path('frontend/dist-demo').mkdir(parents=True)
    dist.write('frontend/dist-demo/demo-release.json', {'revision':SHA,'version':'1.2.3','pipelineId':20})
    Path('installation-receipts').mkdir()
    for key, job in (
        ('quickstart-amd64','release-quickstart-smoke: [amd64]'),
        ('quickstart-arm64','release-quickstart-smoke: [arm64]'),
        ('compose-amd64','release-compose-smoke: [amd64]'),
        ('compose-arm64','release-compose-smoke: [arm64]'),
        ('kind','release-kind-onboarding-smoke'),
    ):
        arch = 'amd64' if key == 'kind' else key.rsplit('-', 1)[-1]
        images = {c:{'id':DIGEST,'arch':arch,'os':'linux','manifest':IMAGE['platforms'][arch]}
                  for c in (('backend','frontend') if key == 'kind' else COMPONENTS)}
        if key == 'kind':
            phases = ('install-and-upgrade',)
        elif key.startswith('quickstart-'):
            phases = ('first-start','restart')
        else:
            phases = ('compose','compose-restart')
        dist.write(f'installation-receipts/{key}.json', {'schema':1,'status':'success','sha':SHA,'version':'1.2.3',
                   'pipeline_id':20,'job_id':ids[job],'candidate_sha256':dist.digest(inventory),
                   'checkpoints':{phase:images for phase in phases}})
    api = SimpleNamespace(jobs=lambda _: jobs, get=lambda _: {'sha':SHA,'ref':'main','source':'parent_pipeline','status':'running'})
    monkeypatch.setattr(dist, 'inspect', lambda *args, **kwargs: IMAGE)
    monkeypatch.setattr(dist, 'verify_release_index', lambda *args, **kwargs: None)
    return api, jobs


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
@pytest.mark.parametrize('status', ['failed', 'canceled', 'skipped', 'missing', 'wrong-sha'])
def test_global_distribution_gate_requires_every_job_and_matrix_member(monkeypatch, tmp_path, stage, status):
    api, jobs = prepared(monkeypatch, tmp_path)
    # Establish a valid proof first, so another precondition cannot mask the gate.
    dist.ready(api)
    jobs[:] = [j for j in jobs if status != 'missing' or j['name'] != stage]
    for job in jobs:
        if job['name'] == stage:
            if status == 'wrong-sha': job['commit']['id'] = 'f' * 40
            else: job['status'] = status
    monkeypatch.setattr(dist, 'verify_public', lambda: pytest.fail('Registry checks must follow the job gate'))
    with pytest.raises(ValueError, match='Unsuccessful|Required pipeline jobs'): dist.ready(api)


@pytest.mark.parametrize('current,published,expected', [
    ('1.2.3', ['1.2.3','1.2.10','1.3.0'], []),
    ('1.2.10', ['1.2.3','1.2.10','1.3.0'], ['1.2']),
    ('1.3.0', ['1.3.0','1.2.10'], ['1.3','latest']),
    ('2.0.0', ['2.0.0','10.0.0'], ['2.0']),
])
def test_serialized_alias_decisions_are_numeric_and_never_regress(current, published, expected):
    assert dist.aliases(current, published) == expected
    with pytest.raises(ValueError): dist.aliases('9.9.9', published)


def test_release_index_requires_all_previous_versions_and_current_latest(monkeypatch):
    monkeypatch.setenv('RELEASE_VERSION', '1.2.3')
    monkeypatch.setattr(dist, 'changelog_releases', lambda: [
        {'version':'1.2.3'}, {'version':'1.2.2'}, {'version':'1.2.1'}
    ])
    state = {'published':['1.2.1']}
    monkeypatch.setattr(dist, 'published_versions', lambda *args: state['published'])

    class API:
        def __init__(self, latest): self.latest = latest
        def request(self, path, **kwargs): return {'tag_name': self.latest}

    gh = API('v1.2.3'); gl = API('v1.2.3')
    with pytest.raises(RuntimeError, match='v1.2.2'):
        dist.verify_release_index(gh, gl, include_current=False)

    state['published'] = ['1.2.1','1.2.2']
    dist.verify_release_index(gh, gl, include_current=False)
    with pytest.raises(RuntimeError, match='v1.2.3'):
        dist.verify_release_index(gh, gl, include_current=True)

    state['published'].append('1.2.3')
    dist.verify_release_index(gh, gl, include_current=True, require_latest=True)
    with pytest.raises(RuntimeError, match='GitHub latest'):
        dist.verify_release_index(API('v1.2.2'), gl, include_current=True, require_latest=True)


def test_finalization_rechecks_artifacts_before_any_public_mutation(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    dist.write('distribution-ready.json', {'files': {'bundle': 'original'}})
    monkeypatch.setattr(dist, 'GitLabAPI', lambda: None)
    monkeypatch.setattr(dist, 'ready', lambda _, **kwargs: {'files': {'bundle': 'changed'}})
    monkeypatch.setattr(dist, 'ensure_github_tag', lambda *args: pytest.fail('Premature stable tag creation'))
    monkeypatch.setattr(dist, 'github', lambda **kwargs: pytest.fail('Premature GitHub publication'))
    with pytest.raises(ValueError, match='stale'): dist.finalize()


def test_finalization_rechecks_both_main_refs_before_creating_tag(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    proof = {'fixture':True, 'bundles':{'files':{}}}
    dist.write('distribution-ready.json', proof)
    for name, value in {'RELEASE_VERSION':'1.2.3', 'CI_COMMIT_SHA':SHA, 'GITHUB_RELEASE_TOKEN':'fixture',
                        'CI_API_V4_URL':'fixture','CI_PROJECT_ID':'1','CI_JOB_TOKEN':'fixture'}.items():
        monkeypatch.setenv(name, value)
    monkeypatch.setattr(dist, 'GitLabAPI', lambda: object())
    monkeypatch.setattr(dist, 'ready', lambda _, **kwargs: proof)
    monkeypatch.setattr(dist, 'verify_remote_main', lambda *args: (_ for _ in ()).throw(RuntimeError('main moved')))
    monkeypatch.setattr(dist, 'ensure_github_tag', lambda *args: pytest.fail('Stable tag must follow the main check'))
    with pytest.raises(RuntimeError, match='main moved'):
        dist.finalize()


def test_interrupted_finalization_can_resume_and_older_retries_do_not_move_aliases(monkeypatch, tmp_path):
    api, _ = prepared(monkeypatch, tmp_path)
    proof = dist.ready(api)
    dist.write('distribution-ready.json', proof)
    monkeypatch.setattr(dist, 'GitLabAPI', lambda: api)
    monkeypatch.setattr(dist, 'verify_remote_main', lambda *args: None)
    monkeypatch.setattr(dist, 'verify_public_release', lambda *args, **kwargs: None)
    monkeypatch.setattr(dist.candidate_registry, 'download', lambda *args: None)
    monkeypatch.setattr(dist.candidate_registry, 'hashes', lambda *args: proof['candidate']['artifact']['files'])
    calls = []
    monkeypatch.setattr(dist, 'promote_stable', lambda proof: calls.append('stable') or {'files':{}})
    monkeypatch.setattr(dist, 'ensure_github_tag', lambda *args: calls.append('tag'))
    monkeypatch.setattr(dist, 'github', lambda **kwargs: calls.append('github'))
    def fail(*args):
        calls.append('gitlab')
        raise RuntimeError('Interrupted between services')
    monkeypatch.setattr(dist, 'publish_gitlab', fail)
    monkeypatch.setattr(dist, 'copy_image', lambda *args, **kwargs: calls.append('alias'))
    with pytest.raises(RuntimeError, match='Interrupted'): dist.finalize()
    assert calls == ['stable','tag','github','gitlab']
    monkeypatch.setattr(dist, 'publish_gitlab', lambda *args: calls.append('gitlab'))
    monkeypatch.setattr(dist, 'resolve_tag', lambda *args: SHA)
    monkeypatch.setattr(dist, 'resolve_git_tag', lambda *args: SHA)
    monkeypatch.setattr(dist, 'published_versions', lambda *args: ['1.2.3','1.2.10'])
    result = dist.finalize()
    assert calls == ['stable','tag','github','gitlab'] * 2
    assert result['sha'] == SHA and result['aliases'] == []


def test_tag_pipeline_only_accepts_an_already_published_matching_release(monkeypatch):
    for name, value in {'RELEASE_VERSION':'1.2.3', 'CI_COMMIT_SHA':SHA,
                        'CI_API_V4_URL':'fixture','CI_PROJECT_ID':'1','CI_JOB_TOKEN':'fixture'}.items():
        monkeypatch.setenv(name, value)
    state = {'github': None, 'gitlab': None}

    class GitHub:
        def request(self, path, **kwargs):
            assert path == 'releases/tags/v1.2.3'
            return state['github']

    class GitLab:
        def request(self, path, **kwargs):
            assert path == 'releases/v1.2.3'
            return state['gitlab']

    monkeypatch.setattr(dist, 'GitHub', lambda token: GitHub())
    monkeypatch.setattr(dist, 'GitLab', lambda *args: GitLab())
    monkeypatch.setattr(dist, 'resolve_tag', lambda *args, **kwargs: SHA)
    monkeypatch.setattr(dist, 'resolve_git_tag', lambda *args, **kwargs: SHA)

    with pytest.raises(RuntimeError, match='GitHub stable tag'):
        dist.verify_release_tag()
    state['github'] = {'draft':False, 'prerelease':False, 'name':'v1.2.3'}
    with pytest.raises(RuntimeError, match='GitLab stable tag'):
        dist.verify_release_tag()
    state['gitlab'] = {'name':'v1.2.3', 'commit':{'id':SHA}}
    dist.verify_release_tag()


def test_public_release_verification_retries_only_transient_visibility(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv('RELEASE_VERSION', '1.2.3')
    monkeypatch.setenv('CI_COMMIT_SHA', SHA)
    Path('dist/release-notes').mkdir(parents=True)
    Path('dist/release-notes/github.md').write_text('Notes')
    attempts = []
    sleeps = []

    def verify(*args, **kwargs):
        attempts.append(kwargs['expected_files'])
        if len(attempts) == 1:
            raise RuntimeError('Missing public release asset: bucketreef-deploy.tar.gz')

    monkeypatch.setattr(dist, 'verify_public_release', verify)
    monkeypatch.setattr(dist.time, 'sleep', sleeps.append)
    expected = {'bucketreef-deploy.tar.gz': 'digest'}
    dist.verify_published_github_release(expected)
    assert attempts == [expected, expected]
    assert sleeps == [dist.PUBLIC_RELEASE_VERIFY_DELAY_SECONDS]

    monkeypatch.setattr(dist, 'verify_public_release', lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError('Public release asset differs')))
    sleeps.clear()
    with pytest.raises(RuntimeError, match='differs'):
        dist.verify_published_github_release(expected)
    assert sleeps == []


def test_child_graphs_cover_every_profile_without_optional_or_dangling_edges():
    for profile in ('qualify', 'prepare-release', 'resume-release', 'release', 'docs', 'recover-release', 'security', 'regression', 'secrets-history', 'bootstrap-release-bundles'):
        plan = {**select(profile, []), 'sha': SHA, 'parent_id': 9}
        if profile == 'resume-release':
            plan['recovery_version'] = '1.2.3'
            plan['recovery_pipeline_id'] = 123
        if profile == 'bootstrap-release-bundles':
            plan['bootstrap_version'] = '1.2.3'
        config = render(plan)
        for name, job in config.items():
            if name.startswith('.') or not isinstance(job, dict): continue
            for need in job.get('needs', []):
                assert need['job'] in config, (profile,name,need)
                assert not need.get('optional')
        if profile == 'qualify':
            assert set(PUBLIC) <= set(config)
            assert 'ceph-functional-tests' in config
            assert config['integration-ready']['artifacts']['expire_in'] == 'never'
        if profile == 'prepare-release':
            assert all(f'build-{component}' in config for component in COMPONENTS)
            assert 'release-ready' in config and 'finalize-release' in config
            assert 'prepare-github-release' not in config
        if profile == 'release':
            assert 'finalize-release' not in config
            assert 'verify-release-tag' in config
            assert 'publish-candidate-images' not in config
        if profile == 'resume-release':
            assert {'resume-release-assets', 'resume-finalize-release', 'resume-demo-deploy'} <= set(config)
            assert config['resume-finalize-release']['variables']['RELEASE_RECOVERY_VERSION'] == '1.2.3'
            assert config['resume-finalize-release']['variables']['RELEASE_RECOVERY_PIPELINE_ID'] == '123'
            assert 'finalize-release' not in config
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


def test_bundle_publication_resumes_identical_manifest_but_rejects_conflicts(monkeypatch, tmp_path):
    monkeypatch.setenv('GHCR_USERNAME','fixture')
    monkeypatch.setenv('GHCR_TOKEN','fixture')
    for name in bundle_registry.ASSETS: (tmp_path/name).write_bytes(b'bundle')
    state = {'remote':None, 'writes':0}
    digest = 'sha256:'+hashlib.sha256(b'{}').hexdigest()
    def run(args, **kwargs):
        if args[0] == 'push':
            Path(args[args.index('--export-manifest')+1]).write_bytes(b'{}')
            assert 'org.opencontainers.image.created=1970-01-01T00:00:00Z' in args
            if '--oci-layout' not in args:
                assert f'{bundle_registry.REPOSITORY}:1.2.3' in args
                assert '--username' in args and '--password-stdin' in args and '--password' not in args
                assert kwargs['input_data'] == b'fixture'
                state['writes'] += 1
                state['remote'] = digest.encode()
        elif args[0] == 'resolve':
            assert '--password-stdin' in args and '--password' not in args
            assert kwargs['input_data'] == b'fixture'
            return state['remote']
        else: raise AssertionError(args)
    monkeypatch.setattr(bundle_registry, 'run', run)
    receipt = bundle_registry.publish('1.2.3', SHA, tmp_path)
    assert receipt['digest'] == digest
    assert bundle_registry.publish('1.2.3', SHA, tmp_path) == receipt
    assert state['writes'] == 1
    state['remote'] = b'sha256:conflicting'
    with pytest.raises(ValueError, match='immutable'):
        bundle_registry.publish('1.2.3', SHA, tmp_path)
    assert state['writes'] == 1


def test_missing_bundle_repository_denial_is_treated_as_absent(monkeypatch):
    result = SimpleNamespace(
        returncode=1,
        stderr=b'Error response from registry: denied: requested access to the resource is denied',
    )
    monkeypatch.setattr(bundle_registry.subprocess, 'run', lambda *args, **kwargs: result)
    assert bundle_registry.run(['resolve', 'fixture'], missing_ok=True) is None
    with pytest.raises(RuntimeError, match='Bundle registry resolve failed'):
        bundle_registry.run(['resolve', 'fixture'])


def test_missing_bundle_repository_not_found_is_treated_as_absent(monkeypatch):
    result = SimpleNamespace(
        returncode=1,
        stderr=b'Error response from registry: failed to resolve digest: ghcr.io/ksperis/bucketreef-bundles:0.2.6: not found',
    )
    monkeypatch.setattr(bundle_registry.subprocess, 'run', lambda *args, **kwargs: result)
    assert bundle_registry.run(['resolve', 'fixture'], missing_ok=True) is None


def test_bundle_registry_error_reports_operation_without_secrets(monkeypatch):
    monkeypatch.setenv('GHCR_TOKEN', 'top-secret-token')
    result = SimpleNamespace(
        returncode=1,
        stderr=b'401 unauthorized top-secret-token',
    )
    monkeypatch.setattr(bundle_registry.subprocess, 'run', lambda *args, **kwargs: result)
    with pytest.raises(RuntimeError) as error:
        bundle_registry.run(['push', '--password', 'top-secret-token', 'fixture'])
    message = str(error.value)
    assert 'Bundle registry push failed (exit 1)' in message
    assert '401 unauthorized [REDACTED]' in message
    assert 'top-secret-token' not in message
    assert '--password' not in message


def test_bundle_bootstrap_uses_immutable_tag_source(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv('GITHUB_RELEASE_TOKEN', 'fixture')
    monkeypatch.setattr(bootstrap_registry, 'git', lambda *args: SHA)
    monkeypatch.setattr(bootstrap_registry, 'resolve_git_tag', lambda *args, **kwargs: SHA)
    monkeypatch.setattr(bootstrap_registry, 'resolve_tag', lambda *args, **kwargs: SHA)
    exported = []
    monkeypatch.setattr(bootstrap_registry, 'export_tag', lambda tag, destination: exported.append(tag))
    commands = []
    monkeypatch.setattr(
        bootstrap_registry.subprocess,
        'run',
        lambda args, **kwargs: commands.append(args) or SimpleNamespace(returncode=0),
    )
    monkeypatch.setattr(
        bundle_registry,
        'publish',
        lambda version, sha, directory: {'schema': 1, 'version': version, 'sha': sha},
    )
    record = bootstrap_registry.bootstrap('1.2.3')
    assert exported == ['v1.2.3']
    assert record == {'schema': 1, 'version': '1.2.3', 'sha': SHA}
    assert commands and commands[0][1].endswith('/ops/release/package_deploy_bundle.py')
    assert json.loads(Path('bundle-distribution.json').read_text()) == record


def test_global_gate_records_files_and_rechecks_original_qualification(monkeypatch, tmp_path):
    api, jobs = prepared(monkeypatch, tmp_path)
    proof = dist.ready(api)
    assert proof['files'] == dist.fingerprints()
    assert len(proof['jobs']) == len(expected_names(dist.REQUIRED))
    # The parent and child can still run; only completed mandatory jobs authorize promotion.
    next(job for job in jobs if job['name'] == 'ceph-functional-tests')['status'] = 'canceled'
    with pytest.raises(ValueError, match='Unsuccessful'): dist.ready(api)


def test_chart_archive_is_reproducible(tmp_path):
    import io
    import tarfile
    outputs = []
    for date in (1, 99):
        path = tmp_path / f'{date}.tgz'
        with tarfile.open(path,'w:gz') as tar:
            entry = tarfile.TarInfo('bucketreef/Chart.yaml')
            data = b'version: 1.2.3\n'
            entry.mtime, entry.size = date, len(data)
            tar.addfile(entry, io.BytesIO(data))
        dist.normalize_chart(path)
        outputs.append(path.read_bytes())
    assert outputs[0] == outputs[1]
