"""Capability skips are visible, but the central Ceph flow must really pass."""
import sys
import xml.etree.ElementTree as ET


def verify(path):
    root = ET.parse(path).getroot()
    cases = list(root.iter("testcase"))
    core = [case for case in cases if case.get("name") == "test_account_bucket_object_flow"]
    if len(core) != 1 or any(core[0].find(tag) is not None for tag in ("failure", "error", "skipped")):
        raise ValueError("The central Ceph account/bucket/object scenario must pass")
    if any(case.find(tag) is not None for case in cases for tag in ("failure", "error")):
        raise ValueError("Ceph suite has unsuccessful scenarios")
    print(f"Ceph: {len(cases)} scenarios, {sum(case.find('skipped') is not None for case in cases)} capability skips")


if __name__ == "__main__":
    verify(sys.argv[1])
