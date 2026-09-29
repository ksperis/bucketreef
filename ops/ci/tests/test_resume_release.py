import io
import json
from pathlib import Path
import subprocess
from types import SimpleNamespace
import zipfile

import pytest

import resume_release as resume
import distribution as dist
from test_distribution import prepared, SHA


def retained(monkeypatch,tmp_path):
    api,jobs=prepared(monkeypatch,tmp_path)
    proof=dist.ready(api)
    dist.write('distribution-ready.json',proof)
    snapshots={str(path):path.read_bytes() for path in [Path('distribution-ready.json'),Path('ci-plan.json'),Path('qualification.json'),
               Path('candidate-inventory.json'),*Path('installation-receipts').glob('*.json')]}
    archive=io.BytesIO()
    with zipfile.ZipFile(archive,'w') as zipped:
        zipped.writestr('frontend/dist-demo/demo-release.json',Path('frontend/dist-demo/demo-release.json').read_bytes())
        zipped.writestr('../must-not-extract','untrusted')
    jobs.append({'id':888,'name':'release-ready','status':'success','commit':{'id':SHA}})
    original=api.get
    api.get=lambda path,**kwargs: archive.getvalue() if path=='jobs/888/artifacts' else original(path)
    api.artifact=lambda job,path:snapshots.get(path)
    monkeypatch.setenv('RELEASE_RECOVERY_VERSION','1.2.3')
    monkeypatch.setenv('RELEASE_RECOVERY_PIPELINE_ID','20')
    monkeypatch.setenv('CI_COMMIT_SHA','e'*40)
    def ancestry(args,**kwargs):
        assert args==['git','merge-base','--is-ancestor',SHA,'e'*40]
    monkeypatch.setattr(resume.subprocess,'run',ancestry)
    def download(inventory,directory):
        directory.mkdir(exist_ok=True)
        for name in inventory['artifact']['files']: (directory/name).write_text('fixture')
    monkeypatch.setattr(resume.candidate_registry,'download',download)
    return api,jobs,proof,snapshots


@pytest.mark.parametrize('version,pipeline',[('0.2','20'),('1.2.3','0'),('1.2.3','-1'),('1.2.3','x')])
def test_recovery_inputs_are_strict(monkeypatch,version,pipeline):
    monkeypatch.setenv('RELEASE_RECOVERY_VERSION',version)
    monkeypatch.setenv('RELEASE_RECOVERY_PIPELINE_ID',pipeline)
    with pytest.raises(ValueError): resume.load_source(None)


def test_resume_restores_only_original_tested_bytes_despite_new_product_checkout(monkeypatch,tmp_path):
    api,_,proof,_=retained(monkeypatch,tmp_path)
    Path('dist/release/bucketreef-compose.tar.gz').write_text('new unqualified application')
    Path('frontend/dist-demo/demo-release.json').write_text('new demo')
    actual,plan=resume.load_source(api)
    assert actual==proof and plan['sha']==SHA
    assert Path('dist/release/bucketreef-compose.tar.gz').read_text()=='fixture'
    assert dist.demo_fingerprints()==proof['demo_files']
    assert dist.release_sha()==SHA
    assert not (tmp_path.parent/'must-not-extract').exists()


@pytest.mark.parametrize('status',['failed','missing','skipped'])
def test_resume_requires_completed_installation_proof(monkeypatch,tmp_path,status):
    api,jobs,_,_=retained(monkeypatch,tmp_path)
    if status=='missing': jobs.pop()
    else: jobs[-1]['status']=status
    with pytest.raises(ValueError): resume.load_source(api)


def test_resume_refuses_legacy_and_tampered_evidence(monkeypatch,tmp_path):
    api,_,proof,snapshots=retained(monkeypatch,tmp_path)
    snapshots['distribution-ready.json']=json.dumps({**proof,'schema':1}).encode()
    with pytest.raises(ValueError,match='Unsupported'): resume.load_source(api)
    snapshots['distribution-ready.json']=json.dumps({**proof,'files':{'wrong':'content'}}).encode()
    with pytest.raises(ValueError,match='no longer matches'): resume.load_source(api)


def test_resume_requires_source_ancestry(monkeypatch,tmp_path):
    api,_,_,_=retained(monkeypatch,tmp_path)
    def fail(args,**kwargs): raise subprocess.CalledProcessError(1,args)
    monkeypatch.setattr(resume.subprocess,'run',fail)
    with pytest.raises(subprocess.CalledProcessError): resume.load_source(api)
