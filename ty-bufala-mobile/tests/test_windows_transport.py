
import io
import json
import unittest
from unittest.mock import Mock
from urllib.error import HTTPError
from windows.herd_sync import RemoteAPI,SyncError


class TransportSafety(unittest.TestCase):
    def test_origin_csrf_relative_route_and_bound_response(self):
        api=RemoteAPI('https://ty-bufala-mobile-test.onrender.com');api.csrf='TEST-ONLY-csrf'
        response=io.BytesIO(json.dumps({'ok':True}).encode());api.opener=Mock();api.opener.open.return_value=response
        self.assertTrue(api.request('sync',{'operations':[]})['ok'])
        request=api.opener.open.call_args.args[0]
        self.assertEqual(request.get_header('Origin'),'https://ty-bufala-mobile-test.onrender.com')
        self.assertEqual(request.get_header('X-csrf-token'),'TEST-ONLY-csrf')
        for route in ('//other.invalid/','https://other.invalid/api','../session'):
            with self.assertRaises(ValueError):api.request(route)
        api.opener.open.return_value=io.BytesIO(b'x'*(8*1024*1024+1))
        with self.assertRaises(SyncError):api.request('changes')

    def test_redirect_and_non_json_error_do_not_leak_body(self):
        api=RemoteAPI('https://ty-bufala-mobile-test.onrender.com');api.opener=Mock()
        api.opener.open.side_effect=HTTPError(api.base,302,'Redirect',{},io.BytesIO(b'TEST-ONLY private body'))
        with self.assertRaisesRegex(SyncError,'Redirection'):api.request('login',{})
        api.opener.open.side_effect=HTTPError(api.base,502,'Proxy',{},io.BytesIO(b'TEST-ONLY private body'))
        with self.assertRaisesRegex(SyncError,'Requête refusée'):api.request('session')
