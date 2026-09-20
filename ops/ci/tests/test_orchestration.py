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
from secret_report import summarize
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
            {'id':30,'sha':'c'*40,'ref':'main','source':'push'},
            {'id':20,'sha':'b'*40,'ref':'main','source':'web'},
            {'id':10,'sha':'a'*40,'ref':'main','source':'push'},
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
