from windows.herd_scheduler import SyncScheduler


class Clock:
    def __init__(self):self.calls={};self.n=0
    def after(self,delay,fn):self.n+=1;self.calls[self.n]=(delay,fn);return self.n
    def cancel(self,token):self.calls.pop(token,None)
    def fire(self,token):self.calls.pop(token)[1]()


class Service:
    def __init__(self):self.runs=0
    def sync(self):self.runs+=1
    def status(self):return 'Confirmé'


def test_start_periodic_manual_no_overlap_and_close():
    clock=Clock();service=Service();workers=[];states=[]
    s=SyncScheduler(service,clock.after,clock.cancel,states.append,launch=workers.append)
    s.start();s.start();assert len(workers)==1 and not s.request()
    workers.pop()();assert service.runs==1 and states==['Synchronisation en cours']
    clock.fire(s.poll_id);assert states[-1]=='Confirmé'
    clock.fire(s.timer_id);assert len(workers)==1
    s.close();workers.pop()();assert not clock.calls
    assert not s.request()


def test_worker_error_is_delivered_by_gui_poll_and_remains_retryable():
    clock=Clock();workers=[];states=[]
    class Broken(Service):
        def sync(self):raise OSError('Hors connexion')
    s=SyncScheduler(Broken(),clock.after,clock.cancel,states.append,launch=workers.append)
    s.start();workers.pop()();clock.fire(s.poll_id)
    assert states[-1]=='Erreur : Hors connexion' and not s.busy
    assert s.request() and len(workers)==1
    s.close()
