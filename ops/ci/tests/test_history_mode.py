from pathlib import Path
import sys
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from plan import classify, select
from render_gitlab import render


def test_history_mode_is_manual_main_only_and_has_no_distribution_jobs():
    assert classify(source='web',ref='main',protected=True,mode='release-history')=='release-history'
    for values in [dict(source='push',ref='main',protected=True),dict(source='web',ref='dev',protected=True),dict(source='web',ref='main',protected=False)]:
        with pytest.raises(ValueError):classify(**values,mode='release-history')
    plan=select('release-history',None)
    assert not plan['jobs'] and not plan['images']
    for apply in [False,True]:
        config=render({**plan,'history_apply':apply})
        jobs=[k for k,v in config.items() if isinstance(v,dict) and 'script' in v and not k.startswith('.')]
        assert sorted(jobs)==['pipeline-plan','publish-release-history']
        assert config['publish-release-history']['variables']['RELEASE_HISTORY_APPLY']==str(apply).lower()
        assert config['publish-release-history']['environment']['name']=='release-public'
