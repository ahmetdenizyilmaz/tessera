import { useState } from 'react';

export function ProxySettings() {
  const [httpProxy, setHttpProxy] = useState('');
  const [httpsProxy, setHttpsProxy] = useState('');
  const [noProxy, setNoProxy] = useState('');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="form-group">
        <label className="form-label">HTTP Proxy</label>
        <input
          className="form-input"
          placeholder="http://proxy:8080"
          value={httpProxy}
          onChange={(e) => setHttpProxy(e.target.value)}
        />
      </div>

      <div className="form-group">
        <label className="form-label">HTTPS Proxy</label>
        <input
          className="form-input"
          placeholder="https://proxy:8443"
          value={httpsProxy}
          onChange={(e) => setHttpsProxy(e.target.value)}
        />
      </div>

      <div className="form-group">
        <label className="form-label">No Proxy</label>
        <input
          className="form-input"
          placeholder="localhost,127.0.0.1,.internal"
          value={noProxy}
          onChange={(e) => setNoProxy(e.target.value)}
        />
        <p className="form-hint">Comma-separated list of hosts to bypass proxy.</p>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary btn-sm">Save Proxy Settings</button>
        <button className="btn btn-secondary btn-sm" onClick={() => { setHttpProxy(''); setHttpsProxy(''); setNoProxy(''); }}>Clear</button>
      </div>
    </div>
  );
}
