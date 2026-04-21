import { useState, useRef, useEffect, useCallback } from 'react';

const API = import.meta.env.VITE_API_URL ?? '';

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Drives the job-based export flow:
 *   1. POST {jobsEndpoint} with {filters} → { job_id }
 *   2. Poll GET {jobsEndpoint}/:id until status=completed or failed
 *   3. Use statusData.download_url (already includes signed token) to stream via <a download>
 *
 * @param {string} jobsEndpoint  e.g. '/api/calls/export/jobs' or '/api/analysis/export/jobs'
 * @param {string} token         Bearer token from useAuth
 * @param {string} fallbackName  Filename to use if the server doesn't provide one
 */
export function useExportJob({ jobsEndpoint, token, fallbackName = 'export.csv' }) {
  const [exporting, setExporting] = useState(false);
  const [label, setLabel] = useState('');
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const runExport = useCallback(async (filters = {}) => {
    setExporting(true);
    setLabel('Queueing export...');

    const POLL_MIN_MS = 800;
    const POLL_MAX_MS = 10_000;
    const MAX_WAIT_MS = 30 * 60 * 1000;
    let delay = POLL_MIN_MS;
    let elapsed = 0;

    try {
      const createRes = await fetch(`${API}${jobsEndpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(filters),
      });
      const createData = await createRes.json();
      if (!createRes.ok) throw new Error(createData.error || 'Failed to queue export');

      const jobId = createData.job_id;

      while (elapsed < MAX_WAIT_MS) {
        if (!mountedRef.current) return;
        await wait(delay);
        elapsed += delay;
        delay = Math.min(delay * 1.5, POLL_MAX_MS);

        const statusRes = await fetch(`${API}${jobsEndpoint}/${jobId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const statusData = await statusRes.json();
        if (!statusRes.ok) throw new Error(statusData.error || 'Failed to check export status');

        if (statusData.status === 'completed') {
          if (!statusData.download_url) throw new Error('Download URL missing');
          setLabel('Downloading...');
          const link = document.createElement('a');
          link.href = `${API}${statusData.download_url}`;
          link.download = statusData.file_name || fallbackName;
          link.rel = 'noopener';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          setLabel('Done');
          return;
        }
        if (statusData.status === 'failed') {
          throw new Error(statusData.error || 'Export failed');
        }

        const rows = Number(statusData.rows_processed || 0);
        setLabel(rows > 0 ? `Processing ${rows.toLocaleString()} rows...` : 'Preparing file...');
      }
      throw new Error('Export timed out. Please narrow your filters and try again.');
    } catch (e) {
      alert(`Export failed: ${e.message}`);
    } finally {
      if (mountedRef.current) {
        setExporting(false);
        setTimeout(() => { if (mountedRef.current) setLabel(''); }, 2500);
      }
    }
  }, [jobsEndpoint, token, fallbackName]);

  return { runExport, exporting, label };
}
