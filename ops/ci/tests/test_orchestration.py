import copy
import json
from pathlib import Path
import sys

import pytest
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from gitlab_api import expected_names, successful_jobs, latest_baseline
from plan import ROOT, PUBLIC, select
from render_gitlab import render
from secret_report import FIXTURE_LOCATIONS, summarize
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
        assert job.get('allow_failure', False) is False
    assert config['ceph-functional-tests']['allow_failure'] is False if 'ceph-functional-tests' in config else True


@pytest.mark.parametrize('status', ['failed', 'canceled', 'skipped', 'manual', 'running'])
def test_private_gate_rejects_non_successful_matrix_member(status):
    names = expected_names(['backend-image-vuln-scan'])
    jobs = [{'id':i,'name':name,'status':'success','allow_failure':False,'commit':{'id':'a'*40}} for i,name in enumerate(names)]
    assert len(successful_jobs(jobs, names, 'a'*40)) == 2
    jobs[1]['status'] = status
    with pytest.raises(ValueError): successful_jobs(jobs, names, 'a'*40)
    with pytest.raises(ValueError): successful_jobs(jobs[:1], names, 'a'*40)


def test_secret_findings_are_redacted_and_invalid_report_fails():
    report = {'scan':{'status':'success'},'vulnerabilities':[{'description':'SENSITIVE','raw_source_code_extract':'SECRET','location':{'file':'a.py','start_line':1},'identifiers':[{'type':'gitleaks','value':'SECRET'}]}]}
    assert 'SECRET' not in json.dumps(summarize(report))
    with pytest.raises(ValueError): summarize({})


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
    for profile in ('integration','qualify','release','docs','security','regression','recover-release','secrets-history'):
        for ref in ('main','dev') if profile == 'integration' else ('main',):
            config = render({**select(profile,None,ref=ref),'sha':'a'*40,'parent_id':1})
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
