import glob
import os

SHARD_JOURNALS = 'journal.shard*.jsonl'


def journals(results):
    found = sorted(glob.glob(os.path.join(results, '*', SHARD_JOURNALS)))
    return [f for f in found if not f.endswith('.wptreport.jsonl')]


def note(html):
    # A sweep's chunks each write journal.shard<k>.jsonl.
    return html + '<p>Each runner writes its own journal.shard file.</p>'
