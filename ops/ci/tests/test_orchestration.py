import copy
import json
from pathlib import Path
import re
import subprocess
import sys

import pytest
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from gitlab_api import evidence_job_names, expected_names, successful_jobs, latest_baseline
from plan import ROOT, PUBLIC, select
from render_gitlab import render
from secret_report import AWS_FIXTURES, FIXTURE_LOCATIONS, HISTORICAL_ENV_EXAMPLES, finding_metadata, summarize
from ceph_result import verify


def test_public_workflow_covers_all_jobs_and_no_privileged_event():
    config = yaml.safe_load((ROOT / '.github/workflows/pr.yml').read_text())
    events = config.get('on', config.get(True))
    assert set(events) == {'pull_request', 'merge_group'}
    assert 'paths' not in events['pull_request']
    assert set(PUBLIC) <= set(config['jobs'])
    assert config['jobs']['required']['if'] == '${{ always() }}'
    assert set(config['jobs']['required']['needs']) == {'plan', *PUBLIC}
    assert config['permissions'] == {'contents': 'read'}


def test_public_validation_uses_full_history_and_runtimes_only_when_needed():
    config = yaml.safe_load((ROOT / '.github/workflows/validate-task.yml').read_text())
    steps = config['jobs']['validate']['steps']
    checkout = next(step for step in steps if str(step.get('uses', '')).startswith('actions/checkout@'))
    setup_python = next(step for step in steps if str(step.get('uses', '')).startswith('actions/setup-python@'))
    setup_node = next(step for step in steps if str(step.get('uses', '')).startswith('actions/setup-node@'))
    assert 'ci-contract' in checkout['with']['fetch-depth']
    assert 'secret-scan' in checkout['with']['fetch-depth']
    assert 'docs-build' in checkout['with']['fetch-depth']
    assert 'backend-tests' in setup_python['if']
    assert 'frontend-quality' in setup_node['if']
    assert 'frontend-audit' in setup_node['if']
    events = config.get('on', config.get(True))
    assert events['workflow_call']['inputs']['shard']['default'] == ''
    assert events['workflow_call']['inputs']['artifact_suffix']['default'] == ''
    secret_resolver = next(step for step in steps if step.get('name') == 'Resolve secret-scan revision')
    revision_check = next(step for step in steps if step.get('name') == 'Verify tested revision')
    assert secret_resolver['if'] == "${{ inputs.task == 'secret-scan' }}"
    assert revision_check['if'] == "${{ inputs.task != 'secret-scan' }}"


@pytest.mark.parametrize('paths', [['README.md'], ['ops/cron/run-billing.sh'], ['backend/app/main.py'], ['ops/release/prepare.py'], None])
def test_selected_graph_has_no_dangling_or_optional_needs(paths):
    plan = {**select('integration', paths), 'sha': 'a'*40, 'parent_id': 10}
    config = render(plan)
    assert set(plan['jobs']) <= set(config)
    for name, job in config.items():
        if name.startswith('.') or not isinstance(job, dict) or 'stage' not in job:
            continue
        for need in job.get('needs', []):
            assert need['job'] in config
            assert not need.get('optional')
            assert isinstance(need.get('artifacts'), bool)
        assert job.get('allow_failure', False) is False
    assert config['ceph-functional-tests']['allow_failure'] is False if 'ceph-functional-tests' in config else True


def test_public_frontend_tests_are_two_fixed_shards_with_distinct_artifacts():
    config = yaml.safe_load((ROOT / '.github/workflows/pr.yml').read_text())
    job = config['jobs']['frontend-tests']
    assert job['strategy']['fail-fast'] is False
    assert job['strategy']['matrix']['include'] == [
        {'shard': '1/2', 'artifact_suffix': '-1-of-2'},
        {'shard': '2/2', 'artifact_suffix': '-2-of-2'},
    ]
    assert job['with']['shard'] == '${{ matrix.shard }}'
    assert job['with']['artifact_suffix'] == '${{ matrix.artifact_suffix }}'


def test_private_vitest_and_artifact_graph_is_explicit_and_parallel():
    integration = render({**select('integration', ['frontend/src/main.tsx']), 'sha': 'a'*40, 'parent_id': 10})
    assert integration['frontend-tests']['parallel']['matrix'] == [{'VITEST_SHARD': ['1/2', '2/2']}]
    expected_build_needs = {'pipeline-plan', 'project-naming', 'ci-contract', 'secret-scan'}
    for name in ('build-backend', 'build-frontend'):
        needs = {item['job']: item['artifacts'] for item in integration[name]['needs']}
        assert set(needs) == expected_build_needs
        assert needs['pipeline-plan'] is True
        assert all(needs[gate] is False for gate in expected_build_needs - {'pipeline-plan'})
    ready = {item['job']: item['artifacts'] for item in integration['integration-ready']['needs']}
    assert ready['build-backend'] is True and ready['build-frontend'] is True
    assert ready['frontend-tests'] is False
    assert ready['frontend-browser-e2e'] is False
    assert ready['frontend-image-vuln-scan'] is False

    qualification = render({**select('qualify', None), 'sha': 'a'*40, 'parent_id': 11})
    qualified_ready = {item['job']: item['artifacts'] for item in qualification['integration-ready']['needs']}
    assert qualified_ready['backend-image-vuln-scan'] is True
    assert qualified_ready['frontend-image-vuln-scan'] is True
    assert qualified_ready['scheduler-image-vuln-scan'] is True
    assert qualified_ready['frontend-tests'] is False

    docs = render({**select('docs', None), 'sha': 'a'*40, 'parent_id': 12})
    deploy = {item['job']: item['artifacts'] for item in docs['docs-deploy']['needs']}
    assert deploy['docs-build'] is True
    assert deploy['docs-screenshots'] is False

    release = render({**select('prepare-release', None), 'sha': 'a'*40, 'parent_id': 13})
    release_deploy = {item['job']: item['artifacts'] for item in release['docs-deploy']['needs']}
    assert release['docs-deploy']['stage'] == 'publish-demo'
    assert release_deploy['docs-build'] is True
    assert release_deploy['docs-screenshots'] is False
    assert release_deploy['finalize-release'] is False

    resume = render({**select('resume-release', None), 'sha': 'a'*40, 'parent_id': 14,
                     'recovery_version': '1.2.3', 'recovery_pipeline_id': 123})
    resume_deploy = {item['job']: item['artifacts'] for item in resume['docs-deploy']['needs']}
    assert resume['docs-deploy']['stage'] == 'publish-demo'
    assert resume_deploy['docs-build'] is True
    assert resume_deploy['docs-screenshots'] is False
    assert resume_deploy['resume-finalize-release'] is False


def test_expected_names_expands_both_vitest_and_image_matrices():
    assert expected_names(['frontend-tests', 'backend-image-vuln-scan']) == [
        'frontend-tests: [1/2]', 'frontend-tests: [2/2]',
        'backend-image-vuln-scan: [amd64]', 'backend-image-vuln-scan: [arm64]',
    ]


def test_only_integration_validation_is_interruptible_by_default():
    integration = render({**select('integration', ['backend/app/main.py']), 'sha': 'a'*40, 'parent_id': 10})
    qualification = render({**select('qualify', None), 'sha': 'a'*40, 'parent_id': 11})
    dev = render({**select('integration', ['backend/app/main.py'], ref='dev'), 'sha': 'a'*40, 'parent_id': 12})
    assert integration['default']['interruptible'] is True
    assert qualification['default']['interruptible'] is False
    assert dev['promote-backend-dev']['interruptible'] is False
    assert dev['promote-frontend-dev']['interruptible'] is False


@pytest.mark.parametrize('status', ['failed', 'canceled', 'skipped', 'manual', 'running'])
def test_private_gate_rejects_non_successful_matrix_member(status):
    names = expected_names(['backend-image-vuln-scan'])
    jobs = [{'id':i,'name':name,'status':'success','allow_failure':False,'commit':{'id':'a'*40}} for i,name in enumerate(names)]
    assert len(successful_jobs(jobs, names, 'a'*40)) == 2
    jobs[1]['status'] = status
    with pytest.raises(ValueError): successful_jobs(jobs, names, 'a'*40)
    with pytest.raises(ValueError): successful_jobs(jobs[:1], names, 'a'*40)


def test_vitest_matrix_requires_every_shard():
    names = expected_names(['frontend-tests'])
    jobs = [{'id': i, 'name': name, 'status': 'success', 'allow_failure': False,
             'commit': {'id': 'a' * 40}} for i, name in enumerate(names)]
    assert len(successful_jobs(jobs, names, 'a' * 40)) == 2
    with pytest.raises(ValueError):
        successful_jobs(jobs[:1], names, 'a' * 40)
    jobs[1]['status'] = 'failed'
    with pytest.raises(ValueError):
        successful_jobs(jobs, names, 'a' * 40)


def test_secret_findings_are_redacted_and_invalid_report_fails():
    report = {'scan':{'status':'success'},'vulnerabilities':[{'description':'SENSITIVE','raw_source_code_extract':'SECRET','location':{'file':'a.py','start_line':1},'identifiers':[{'type':'gitleaks','value':'SECRET'}]}]}
    assert 'SECRET' not in json.dumps(summarize(report))
    with pytest.raises(ValueError): summarize({})


def test_secret_finding_metadata_never_exposes_extract():
    finding = {
        'raw_source_code_extract': 'SENSITIVE-VALUE',
        'location': {'file': 'a.py', 'start_line': 4, 'commit': {'sha': '0' * 40}},
        'identifiers': [{'type': 'gitleaks_rule_id', 'value': 'Password in URL'}],
    }
    metadata = finding_metadata(finding)
    assert 'SENSITIVE-VALUE' not in json.dumps(metadata)
    assert metadata['file'] == 'a.py'
    assert metadata['line'] == 4
    assert metadata['commit_sha'] == '0' * 40
    assert metadata['extract_length'] == len('SENSITIVE-VALUE')


@pytest.mark.parametrize('path,extract', [(path, url) for path, urls in FIXTURE_LOCATIONS.items() for url in urls])
def test_only_exact_disposable_postgresql_findings_are_exempt(path, extract):
    finding = {'location': {'file': path, 'start_line': 27},
               'raw_source_code_extract': extract,
               'identifiers': [{'type': 'gitleaks_rule_id', 'value': 'Password in URL'}]}
    report = {'scan': {'status': 'success'}, 'vulnerabilities': [finding]}
    assert summarize(report) == []
    for field, replacement in (
        ('location', {'file': 'backend/app/config.py'}),
        ('raw_source_code_extract', extract + '.example.com'),
        ('raw_source_code_extract', extract.replace('bucketreef-test-password', 'unexpected-password')),
        ('raw_source_code_extract', extract + '\nadditional sensitive content'),
        ('identifiers', [{'type': 'gitleaks_rule_id', 'value': 'another-rule'}]),
        ('identifiers', []),
    ):
        modified = copy.deepcopy(report)
        modified['vulnerabilities'][0][field] = replacement
        assert len(summarize(modified)) == 1
    report['scan']['status'] = 'failure'
    with pytest.raises(ValueError): summarize(report)


@pytest.mark.parametrize('path,extract', [(path, value) for path, values in AWS_FIXTURES.items() for value in values])
def test_synthetic_aws_identifiers_require_exact_value_rule_and_file(path, extract):
    finding = {'location': {'file': path}, 'raw_source_code_extract': extract,
               'identifiers': [{'type': 'gitleaks_rule_id', 'value': 'AWS'}]}
    report = {'scan': {'status': 'success'}, 'vulnerabilities': [finding]}
    assert summarize(report) == []
    for field, value in (
        ('location', {'file': 'backend/app/config.py'}),
        ('raw_source_code_extract', extract[:-1] + 'X'),
        ('raw_source_code_extract', extract + '\nextra'),
        ('raw_source_code_extract', None),
        ('identifiers', [{'type': 'gitleaks_rule_id', 'value': 'Password in URL'}]),
        ('identifiers', [{'type': 'other', 'value': 'AWS'}]),
    ):
        changed = copy.deepcopy(report)
        changed['vulnerabilities'][0][field] = value
        assert len(summarize(changed)) == 1


@pytest.mark.parametrize('commit', HISTORICAL_ENV_EXAMPLES)
def test_removed_localhost_examples_are_bound_to_the_original_commit(commit, monkeypatch):
    # Exercise the actual historic example without copying retired identifiers
    # or example credentials into current source files and scanner findings.
    source = subprocess.check_output(['git', 'show', f'{commit}:backend/.env.example'], cwd=ROOT, text=True)
    extract, = re.findall(r'postgresql\+psycopg://[^:\s]+:[^@\s]+@[^:/\s]+', source)
    finding = {'location': {'file': 'backend/.env.example', 'commit': {'sha': commit}},
               'raw_source_code_extract': extract,
               'identifiers': [{'type': 'gitleaks_rule_id', 'value': 'Password in URL'}]}
    report = {'scan': {'status': 'success'}, 'vulnerabilities': [finding]}
    assert summarize(report) == []
    without_commit = copy.deepcopy(report)
    without_commit['vulnerabilities'][0]['location'].pop('commit')
    assert summarize(without_commit) == []
    placeholder_commit = copy.deepcopy(report)
    placeholder_commit['vulnerabilities'][0]['location']['commit'] = {'sha': '0000000'}
    assert summarize(placeholder_commit) == []
    full_placeholder_commit = copy.deepcopy(report)
    full_placeholder_commit['vulnerabilities'][0]['location']['commit'] = {'sha': '0' * 40}
    assert summarize(full_placeholder_commit) == []
    with monkeypatch.context() as scoped:
        scoped.setattr(Path, 'read_text', lambda self: extract)
        assert len(summarize(without_commit)) == 1
    for field, value in (
        ('location', {'file': 'backend/.env.example', 'commit': {'sha': 'a' * 40}}),
        ('location', {'file': 'backend/app/config.py', 'commit': {'sha': commit}}),
        ('raw_source_code_extract', extract + '.example.com'),
        ('identifiers', [{'type': 'gitleaks_rule_id', 'value': 'AWS'}]),
    ):
        changed = copy.deepcopy(report)
        changed['vulnerabilities'][0][field] = value
        assert len(summarize(changed)) == 1


@pytest.mark.parametrize('commit,line', [
    ('c89e196026d1e085d3c31746d2390ab4d0f8015a', 55),
    ('e013194c9439fc2f728ba7d16035c4e77edada4a', 68),
])
def test_removed_onboarding_password_urls_work_without_report_commit(commit, line):
    source = subprocess.check_output(
        ['git', 'show', f'{commit}:backend/tests/test_admin_onboarding.py'],
        cwd=ROOT, text=True,
    ).splitlines()[line - 1]
    extract, = re.findall(r'https://[^"\s]+', source)
    finding = {
        'location': {'file': 'backend/tests/test_admin_onboarding.py', 'start_line': line},
        'raw_source_code_extract': extract,
        'identifiers': [{'type': 'gitleaks_rule_id', 'value': 'Password in URL'}],
    }
    report = {'scan': {'status': 'success'}, 'vulnerabilities': [finding]}
    assert summarize(report) == []
    finding['location']['commit'] = {'sha': '0000000'}
    assert summarize(report) == []
    finding['location']['commit'] = {'sha': '0' * 40}
    assert summarize(report) == []
    changed = copy.deepcopy(report)
    changed['vulnerabilities'][0]['raw_source_code_extract'] = extract + '.changed'
    assert len(summarize(changed)) == 1


def test_removed_password_url_accepts_pre_removal_report_commit_only():
    source = subprocess.check_output(
        ['git', 'show', 'c89e196026d1e085d3c31746d2390ab4d0f8015a:backend/tests/test_admin_onboarding.py'],
        cwd=ROOT, text=True,
    ).splitlines()[54]
    extract, = re.findall(r'https://[^"\s]+', source)
    finding = {
        'location': {
            'file': 'backend/tests/test_admin_onboarding.py',
            'start_line': 55,
            'commit': {'sha': '0552282df4531a91c60d0f79f2f3697f3f81184d'},
        },
        'raw_source_code_extract': extract,
        'identifiers': [{'type': 'gitleaks_rule_id', 'value': 'Password in URL'}],
    }
    report = {'scan': {'status': 'success'}, 'vulnerabilities': [finding]}
    assert summarize(report) == []
    finding['location']['commit'] = {'sha': '54e42de088d8ba3208657410e984cd307c4c1f8e'}
    assert len(summarize(report)) == 1


def test_removed_env_url_accepts_pre_removal_report_commit_only():
    source = subprocess.check_output(
        ['git', 'show', '97df1e1e8bd66688d7c1a1313cc42b4d9f3756a8:backend/.env.example'],
        cwd=ROOT, text=True,
    )
    extract, = re.findall(r'postgresql\+psycopg://[^:\s]+:[^@\s]+@[^:/\s]+', source)
    finding = {
        'location': {
            'file': 'backend/.env.example',
            'commit': {'sha': '00836399fb0a2637718945355d5a7d065e2cc7d8'},
        },
        'raw_source_code_extract': extract,
        'identifiers': [{'type': 'gitleaks_rule_id', 'value': 'Password in URL'}],
    }
    report = {'scan': {'status': 'success'}, 'vulnerabilities': [finding]}
    assert summarize(report) == []
    finding['location']['commit'] = {'sha': '20928ea6415bf5bd5ee23fe271d7ffaea4764bd5'}
    assert len(summarize(report)) == 1


def test_removed_compose_example_is_bound_to_the_removed_historical_value():
    source = subprocess.check_output(
        ['git', 'show', '4eafda697620b5f88da52377679c55182ffeada6:deploy/compose/.env.example'],
        cwd=ROOT,
        text=True,
    )
    extract, = re.findall(r'postgresql\+psycopg://[^:\s]+:[^@\s]+@[^/\s]+', source)
    finding = {
        'location': {
            'file': 'deploy/compose/.env.example',
            'commit': {'sha': '4eafda697620b5f88da52377679c55182ffeada6'},
        },
        'raw_source_code_extract': extract,
        'identifiers': [{'type': 'gitleaks_rule_id', 'value': 'Password in URL'}],
    }
    report = {'scan': {'status': 'success'}, 'vulnerabilities': [finding]}
    assert summarize(report) == []
    changed = copy.deepcopy(report)
    changed['vulnerabilities'][0]['raw_source_code_extract'] = extract + '.changed'
    assert len(summarize(changed)) == 1
    finding['location']['commit'] = {'sha': '3900ea5bfaf9eac3189ce1bf9ce37936ab0f130b'}
    assert len(summarize(report)) == 1


@pytest.mark.parametrize('body', ['', '<skipped/>', '<failure/>', '<error/>'])
def test_ceph_core_is_required(tmp_path, body):
    path=tmp_path/'junit.xml'
    path.write_text(f'<testsuite><testcase name="test_account_bucket_object_flow">{body}</testcase></testsuite>')
    if body:
        with pytest.raises(ValueError): verify(path)
    else: verify(path)


class BaselineAPI:
    def __init__(self):
        self.parents = [
            {'id':30,'sha':'c'*40,'ref':'main','source':'push','status':'success'},
            {'id':20,'sha':'b'*40,'ref':'main','source':'web','status':'success'},
            {'id':10,'sha':'a'*40,'ref':'main','source':'push','status':'success'},
        ]

    def pages(self, path):
        if path.startswith('pipelines?'): return iter(self.parents)
        parent_id=int(path.split('/')[1])
        return iter([{'name':'run-selected','status':'success','downstream_pipeline':{'id':parent_id+1}}])

    def get(self, path):
        parent=next(item for item in self.parents if item['id']==int(path.split('/')[1])-1)
        return {**parent,'id':parent['id']+1,'source':'parent_pipeline','status':'success'}

    def jobs(self, child_id):
        sha=next(item['sha'] for item in self.parents if item['id']==child_id-1)
        # 30 is a docs-only deployment; it must never become an integration baseline.
        if child_id==31: return []
        return [{'id':child_id*10,'name':'integration-ready','status':'success','commit':{'id':sha}},
                {'id':child_id*10+1,'name':'backend-tests','status':'success','commit':{'id':sha}}]

    def artifact(self, job_id, path):
        child_id=job_id//10
        parent=next(item for item in self.parents if item['id']==child_id-1)
        return json.dumps({'schema':1,'sha':parent['sha'],'ref':'main','pipeline_id':child_id,'parent_id':parent['id'],
                           'plan':{'jobs':['backend-tests'],'profile':'integration'},'jobs':{'backend-tests':job_id+1}}).encode()


def test_baseline_uses_completed_integration_not_documentation():
    assert latest_baseline(BaselineAPI(), 'main') == 'b'*40


def test_historical_matrix_names_do_not_depend_on_current_expansion_rules():
    jobs = [
        {'name': 'backend-tests'},
        {'name': 'release-bundle-smoke: [amd64]'},
        {'name': 'release-bundle-smoke: [arm64]'},
        {'name': 'unrelated-job'},
    ]
    assert evidence_job_names(jobs, ['backend-tests', 'release-bundle-smoke']) == [
        'backend-tests',
        'release-bundle-smoke: [amd64]',
        'release-bundle-smoke: [arm64]',
    ]


def test_modified_or_missing_evidence_is_not_accepted():
    api=BaselineAPI()
    original=api.artifact
    api.artifact=lambda job,path: original(job,path).replace(b'"schema": 1', b'"schema": 9')
    with pytest.raises(ValueError): latest_baseline(api,'main')


def test_job_api_read_never_accepts_allow_failure_or_wrong_sha():
    job={'id':1,'name':'ceph','status':'success','allow_failure':True,'commit':{'id':'a'*40}}
    with pytest.raises(ValueError): successful_jobs([job],['ceph'],'a'*40)
    job['allow_failure']=False
    with pytest.raises(ValueError): successful_jobs([job],['ceph'],'b'*40)


@pytest.mark.parametrize('status', ['canceled','failed','running'])
def test_unsuccessful_parent_never_advances_baseline(status):
    api = BaselineAPI()
    api.parents[1]['status'] = status
    assert latest_baseline(api, 'main') == 'a'*40


def test_child_pipeline_must_be_finished_before_evidence_is_used():
    api = BaselineAPI()
    original = api.get
    api.get = lambda path: {**original(path), 'status':'running'}
    assert latest_baseline(api, 'main') is None


def test_every_selected_job_explains_its_reason():
    for profile in ('pr','qualify','docs','regression','security'):
        plan = select(profile, ['ops/cron/run.sh'])
        assert set(plan['reasons']) == set(plan['jobs'])
        assert all(plan['reasons'].values())


def test_node_browser_and_all_images_are_locked():
    from toolchain import TOOLS
    lock = json.loads((ROOT/'frontend/package-lock.json').read_text())
    assert lock['packages']['node_modules/@playwright/test']['version'] == TOOLS['playwright']
    assert (ROOT/'frontend/.node-version').read_text().strip() == TOOLS['node']
    config = render({**select('qualify', []), 'sha':'a'*40, 'parent_id':1})
    for name, job in config.items():
        if not isinstance(job, dict) or 'image' not in job: continue
        value = job['image']
        image = value if isinstance(value,str) else value['name']
        if image.startswith('$'): image = config['variables'][image[1:]]
        assert '@sha256:' in image, (name,image)
    assert 'script_failure' not in json.dumps(config['default']['retry'])
    assert config['frontend-browser-e2e']['cache'][1]['key']['prefix'].startswith('trusted-npm-24.')


def test_assembled_graphs_are_acyclic_and_dependencies_never_point_to_later_stages():
    from render_gitlab import templates
    for profile in ('integration','qualify','prepare-release','resume-release','release','docs','security','regression','recover-release','secrets-history','bootstrap-release-bundles'):
        for ref in ('main','dev') if profile == 'integration' else ('main',):
            plan = {**select(profile,None,ref=ref),'sha':'a'*40,'parent_id':1}
            if profile == 'resume-release':
                plan['recovery_version'] = '1.2.3'
                plan['recovery_pipeline_id'] = 123
            if profile == 'bootstrap-release-bundles':
                plan['bootstrap_version'] = '1.2.3'
            config = render(plan)
            stages = config['stages']
            def resolve(name):
                job = config[name]
                parent = resolve(job['extends']) if 'extends' in job else {}
                return {**parent, **job}
            jobs = {name:resolve(name) for name in config if name not in {'stages','variables','default','workflow'} and not name.startswith('.')}
            visited, active = set(), set()
            def visit(name):
                assert name not in active, ('cycle',name)
                if name in visited: return
                active.add(name)
                for need in jobs[name].get('needs',[]):
                    assert stages.index(jobs[need['job']]['stage']) <= stages.index(jobs[name]['stage'])
                    visit(need['job'])
                active.remove(name)
                visited.add(name)
            for name in jobs: visit(name)
