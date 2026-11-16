import io
import pytest
from server import onedrive


def test_known_metadata_avoids_duplicate_request_but_still_checks_etag(monkeypatch):
    graph = onedrive.Graph('private-token')
    calls = []
    metadata = {'id': 'item', 'eTag': 'etag-1',
                '@microsoft.graph.downloadUrl': 'https://storage.example.test/download'}
    def call(path):
        calls.append(path)
        return dict(metadata)
    def download(request, timeout):
        assert not request.has_header('Authorization')
        return io.BytesIO(b'synthetic content')
    graph.call = call
    monkeypatch.setattr(onedrive, 'urlopen', download)
    assert graph.download('drive', 'item', metadata)[0] == b'synthetic content'
    assert calls == ['drives/drive/items/item']
    graph.call = lambda path: {**metadata, 'eTag': 'etag-2'}
    with pytest.raises(RuntimeError, match='modifié'):
        graph.download('drive', 'item', metadata)
    with pytest.raises(RuntimeError, match='différentes'):
        graph.download('drive', 'wrong-item', metadata)
