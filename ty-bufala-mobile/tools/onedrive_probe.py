"""Explicit synthetic trial in a NEW subfolder of the application's approot.

Never imports farm data, deletes files, or touches the existing Excel workbook.
Both competing upload sessions must open before either uploads its final chunk.
"""
import argparse
import json
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote
from server.microsoft_auth import LocalTokenProvider
from server.onedrive import Graph, GraphError


def probe(token_path):
    provider = LocalTokenProvider(token_path)
    token = provider()  # Refresh once before starting the two concurrent clients.
    graph = Graph(token)
    root = graph.call('me/drive/special/approot')
    drive = root['parentReference']['driveId']
    name = 'verification-synthetique-' + uuid.uuid4().hex
    folder = graph.call('drives/' + quote(drive, safe='') + '/items/' +
                        quote(root['id'], safe='') + '/children', 'POST',
                        {'name': name, 'folder': {}, '@microsoft.graph.conflictBehavior': 'fail'})
    folder_id = folder['id']
    content = b'Ty Bufala synthetic storage trial. No farm data.\n'
    graph.upload_new(drive, folder_id, 'roundtrip.txt', content)
    barrier = threading.Barrier(2, timeout=45)

    class CompetingGraph(Graph):
        def call(self, path, method='GET', body=None):
            result = super().call(path, method, body)
            if path.endswith('/createUploadSession'):
                barrier.wait()
            return result

    def compete(index):
        value = ('synthetic-writer-' + str(index)).encode()
        try:
            item = CompetingGraph(token).upload_new(drive, folder_id, 'conflict.txt', value)
            return {'writer': index, 'status': 'created', 'id': item['id']}
        except GraphError as error:
            if error.status in (409, 412):
                return {'writer': index, 'status': 'conflict'}
            raise

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(compete, (1, 2)))
    winners = [row for row in results if row['status'] == 'created']
    if len(winners) != 1 or sum(row['status'] == 'conflict' for row in results) != 1:
        raise RuntimeError('Atomicité non démontrée : stockage métier interdit.')
    downloaded, _ = graph.download(drive, winners[0]['id'])
    if downloaded != ('synthetic-writer-' + str(winners[0]['writer'])).encode():
        raise RuntimeError('Contenu concurrent incohérent : stockage métier interdit.')
    return {'status': 'synthetic_trial_passed', 'folder': name,
            'drive_id': drive, 'folder_id': folder_id, 'results': results,
            'production_ready': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tokens', required=True)
    args = parser.parse_args()
    print(json.dumps(probe(args.tokens)))


if __name__ == '__main__':
    main()
