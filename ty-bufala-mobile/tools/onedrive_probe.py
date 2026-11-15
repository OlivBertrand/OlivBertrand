"""Explicit synthetic trial in a NEW subfolder of the application's approot.

Never imports farm data, deletes files, or touches the existing Excel workbook.
Both session-creation attempts finish before either client uploads its final
chunk. Microsoft may already refuse the second session with HTTP 409.
"""
import argparse
import json
import sys
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
    print('Connexion Graph : lecture du dossier application.', file=sys.stderr, flush=True)
    root = graph.call('me/drive/special/approot')
    drive = root['parentReference']['driveId']
    name = 'verification-synthetique-' + uuid.uuid4().hex
    folder = graph.call('drives/' + quote(drive, safe='') + '/items/' +
                        quote(root['id'], safe='') + '/children', 'POST',
                        {'name': name, 'folder': {}, '@microsoft.graph.conflictBehavior': 'fail'})
    folder_id = folder['id']
    print('Dossier synthétique créé ; dépôt et relecture.', file=sys.stderr, flush=True)
    content = b'Ty Bufala synthetic storage trial. No farm data.\n'
    graph.upload_new(drive, folder_id, 'roundtrip.txt', content)
    print('Dépôt et relecture vérifiés ; ouverture des sessions concurrentes.', file=sys.stderr, flush=True)
    barrier = threading.Barrier(2, timeout=45)

    class CompetingGraph(Graph):
        session_opened = False

        def call(self, path, method='GET', body=None):
            if not path.endswith('/createUploadSession'):
                return super().call(path, method, body)
            try:
                result = super().call(path, method, body)
                self.session_opened = True
                return result
            finally:
                # A refused session is ALSO a completed attempt. Otherwise the
                # successful client waits for a participant that already exited.
                barrier.wait()

    def compete(index):
        value = ('synthetic-writer-' + str(index)).encode()
        client = CompetingGraph(token)
        try:
            item = client.upload_new(drive, folder_id, 'conflict.txt', value)
            return {'writer': index, 'status': 'created', 'id': item['id']}
        except GraphError as error:
            if error.status in (409, 412):
                return {'writer': index, 'status': 'conflict',
                        'phase': 'upload' if client.session_opened else 'session'}
            return {'writer': index, 'status': 'graph_error', 'http_status': error.status}
        except Exception as error:
            # Retain BOTH outcomes; never print preauthenticated URLs or tokens.
            return {'writer': index, 'status': 'error', 'type': type(error).__name__}

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(compete, (1, 2)))
    winners = [row for row in results if row['status'] == 'created']
    if len(winners) != 1 or sum(row['status'] == 'conflict' for row in results) != 1:
        return {'status': 'concurrency_unproven', 'folder': name, 'results': results,
                'roundtrip_verified': True, 'production_ready': False}
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
