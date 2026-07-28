import React, { useEffect, useState } from 'react';
import '../styles/Procurement.css';
import { PageHeader } from '../components/masterData/MasterDataPrimitives';
import { fetchSettings, updateSettings } from '../services/settingsService';

const PAGE_PRESETS = [
  { label: 'A4', width: 210, height: 297 },
  { label: 'A5', width: 148, height: 210 },
  { label: 'Letter', width: 215.9, height: 279.4 },
  { label: 'Legal', width: 215.9, height: 355.6 },
];

const DEFAULTS = {
  print_margin_top: '15',
  print_margin_bottom: '15',
  print_margin_left: '10',
  print_margin_right: '10',
  print_page_width: '210',
  print_page_height: '297',
};

const PREVIEW_HEIGHT = 320;

const Settings = ({ token, embedded = false }) => {
  const [values, setValues] = useState(DEFAULTS);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const settings = await fetchSettings(token);
      setValues({ ...DEFAULTS, ...settings });
    } catch (err) {
      setError(err.message || 'Unable to load settings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [token]);

  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => setSuccess(''), 3000);
    return () => clearTimeout(timer);
  }, [success]);

  const setField = (key, value) => setValues((prev) => ({ ...prev, [key]: value }));

  const applyPreset = (preset) => {
    setField('print_page_width', String(preset.width));
    setField('print_page_height', String(preset.height));
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const numericValues = {};
      Object.entries(values).forEach(([key, value]) => {
        numericValues[key] = String(Number(value) || 0);
      });
      await updateSettings(token, numericValues);
      setSuccess('Print page setup saved.');
      setValues((prev) => ({ ...prev, ...numericValues }));
    } catch (err) {
      setError(err.message || 'Unable to save settings');
    } finally {
      setSaving(false);
    }
  };

  const width = Number(values.print_page_width) || 210;
  const height = Number(values.print_page_height) || 297;
  const marginTop = Number(values.print_margin_top) || 0;
  const marginBottom = Number(values.print_margin_bottom) || 0;
  const marginLeft = Number(values.print_margin_left) || 0;
  const marginRight = Number(values.print_margin_right) || 0;
  const scale = PREVIEW_HEIGHT / Math.max(height, 1);
  const previewWidth = width * scale;

  const content = (
    <>
      {!embedded ? <PageHeader breadcrumb={['Dashboard', 'Access Control', 'Print Page Setup']} title="Print Page Setup" description="Configure the page size and margins used when printing documents." actions={null} /> : null}
      {success ? <div className="status-banner status-banner-success status-banner-autodismiss" style={{ marginBottom: '1rem' }}>{success}</div> : null}
      {error ? <div className="status-banner status-banner-error" style={{ marginBottom: '1rem' }}>{error}</div> : null}

      <div className="procurement-shell">
        <div className="procurement-card" style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 320px', minWidth: '280px' }}>
            <strong>Page Size</strong>
            <div className="procurement-actions" style={{ margin: '10px 0 16px' }}>
              {PAGE_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  className={`master-button ${width === preset.width && height === preset.height ? 'master-button-primary' : 'master-button-secondary'}`}
                  onClick={() => applyPreset(preset)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div className="procurement-grid">
              <div className="form-field">
                <label>Page Width (mm)</label>
                <input type="number" min="1" step="0.1" value={values.print_page_width} onChange={(e) => setField('print_page_width', e.target.value)} />
              </div>
              <div className="form-field">
                <label>Page Height (mm)</label>
                <input type="number" min="1" step="0.1" value={values.print_page_height} onChange={(e) => setField('print_page_height', e.target.value)} />
              </div>
            </div>

            <strong style={{ display: 'block', marginTop: '20px' }}>Margins (mm)</strong>
            <div className="procurement-grid" style={{ marginTop: '10px' }}>
              <div className="form-field">
                <label>Top</label>
                <input type="number" min="0" step="0.1" value={values.print_margin_top} onChange={(e) => setField('print_margin_top', e.target.value)} />
              </div>
              <div className="form-field">
                <label>Bottom</label>
                <input type="number" min="0" step="0.1" value={values.print_margin_bottom} onChange={(e) => setField('print_margin_bottom', e.target.value)} />
              </div>
              <div className="form-field">
                <label>Left</label>
                <input type="number" min="0" step="0.1" value={values.print_margin_left} onChange={(e) => setField('print_margin_left', e.target.value)} />
              </div>
              <div className="form-field">
                <label>Right</label>
                <input type="number" min="0" step="0.1" value={values.print_margin_right} onChange={(e) => setField('print_margin_right', e.target.value)} />
              </div>
            </div>

            <button type="button" className="master-button master-button-primary" onClick={save} disabled={saving || loading} style={{ marginTop: '20px' }}>
              {saving ? 'Saving...' : 'Save Print Setup'}
            </button>
          </div>

          <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
            <strong>Preview</strong>
            <div
              style={{
                width: `${previewWidth}px`,
                height: `${PREVIEW_HEIGHT}px`,
                background: '#fff',
                border: '1px solid var(--md-border-strong)',
                boxShadow: 'var(--md-shadow-lg)',
                position: 'relative',
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: `${marginTop * scale}px`,
                  bottom: `${marginBottom * scale}px`,
                  left: `${marginLeft * scale}px`,
                  right: `${marginRight * scale}px`,
                  border: '1.5px dashed var(--md-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <span style={{ fontSize: '11px', color: 'var(--md-muted)', textAlign: 'center', padding: '4px' }}>Printable area</span>
              </div>
            </div>
            <span style={{ fontSize: '12px', color: 'var(--md-muted)' }}>{width} &times; {height} mm</span>
          </div>
        </div>
      </div>
    </>
  );

  if (embedded) return content;
  return <div className="master-shell"><main className="master-content">{content}</main></div>;
};

export default Settings;
