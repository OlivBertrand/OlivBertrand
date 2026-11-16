"""Tk polling controller; only poll touches GUI, one worker at a time."""
from queue import Queue, Empty
from threading import Thread


class SyncScheduler:
    def __init__(self,service,after,after_cancel,onchange,interval_ms=30000,launch=None):
        self.service=service;self.after=after;self.after_cancel=after_cancel;self.onchange=onchange
        self.interval_ms=max(1000,interval_ms);self.messages=Queue();self.closed=True;self.busy=False
        self.poll_id=None;self.timer_id=None;self.launch=launch or self._thread

    @staticmethod
    def _thread(fn):
        Thread(target=fn,daemon=True,name='TyBufalaHerdSync').start()

    def start(self):
        if not self.closed:return
        self.closed=False;self.poll_id=self.after(100,self._poll);self.request()

    def request(self):
        if self.closed or self.busy:return False
        if self.timer_id is not None:self.after_cancel(self.timer_id);self.timer_id=None
        self.busy=True;self.onchange('Synchronisation en cours')
        def work():
            try:self.service.sync();self.messages.put(('done',None))
            except Exception as error:self.messages.put(('error',str(error)))
        try:self.launch(work)
        except Exception:
            self.busy=False;raise
        return True

    def _poll(self):
        if self.closed:return
        try:
            while True:
                kind,error=self.messages.get_nowait();self.busy=False
                self.onchange('Erreur : '+error if kind=='error' else self.service.status())
                if self.timer_id is not None:self.after_cancel(self.timer_id)
                self.timer_id=self.after(self.interval_ms,self._scheduled)
        except Empty:pass
        self.poll_id=self.after(100,self._poll)

    def _scheduled(self):
        self.timer_id=None;self.request()

    def close(self):
        self.closed=True
        for token in (self.poll_id,self.timer_id):
            if token is not None:self.after_cancel(token)
        self.poll_id=None;self.timer_id=None
