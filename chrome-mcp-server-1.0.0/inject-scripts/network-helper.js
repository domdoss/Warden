/* eslint-disable */
/**
 * Network Capture Helper
 *
 * This script helps replay network requests with the original cookies and headers.
 */

// Prevent duplicate initialization
if (window.__NETWORK_CAPTURE_HELPER_INITIALIZED__) {
  // Already initialized, skip
} else {
  window.__NETWORK_CAPTURE_HELPER_INITIALIZED__ = true;

  /**
   * Replay a network request
   * @param {string} url - The URL to send the request to
   * @param {string} method - The HTTP method to use
   * @param {Object} headers - The headers to include in the request
   * @param {any} body - The body of the request
   * @param {number} timeout - Timeout in milliseconds (default: 30000)
   * @returns {Promise<Object>} - The response data
   */
  async function replayNetworkRequest(
    url,
    method,
    headers,
    body,
    timeout = 30000,
    formDataDescriptor = null,
  ) {
    try {
      // Create fetch options
      const options = {
        method: method,
        headers: headers || {},
        credentials: 'include', // Include cookies
        mode: 'cors',
        cache: 'no-cache',
      };

      // Helper: convert base64 to Blob
      const base64ToBlob = (base64, contentType = 'application/octet-stream') => {
        try {
          const decodedString = atob(base64);
          const len = decodedString.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) bytes[i] = decodedString.charCodeAt(i);
          return new Blob([bytes], { type: contentType });
        } catch (e) {
          return new Blob([]);
        }
      };

      // Helper: request native to read filePath into base64
      const readFileBase64 = (path) =>
        new Promise((resolve) => {
          const requestId = `net-helper-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const timeoutId = setTimeout(() => {
            cleanup();
            resolve(null);
          }, 30000);
          function onMessage(msg) {
            if (
              msg &&
              msg.type === 'file_operation_response' &&
              msg.responseToRequestId === requestId
            ) {
              cleanup();
              const p = msg.payload || {};
              if (p.success && p.base64Data)
                resolve({ base64: p.base64Data, fileName: p.fileName });
              else resolve(null);
            }
          }
          function cleanup() {
            clearTimeout(timeoutId);
            chrome.runtime.onMessage.removeListener(onMessage);
          }
          chrome.runtime.onMessage.addListener(onMessage);
          chrome.runtime
            .sendMessage({
              type: 'forward_to_native',
              message: {
                type: 'file_operation',
                requestId,
                payload: { action: 'readBase64File', filePath: path },
              },
            })
            .catch(() => {
              cleanup();
              resolve(null);
            });
        });

      // Build multipart/form-data if descriptor is provided
      if (method !== 'GET' && method !== 'HEAD' && formDataDescriptor) {
        const fd = new FormData();
        try {
          if (Array.isArray(formDataDescriptor)) {
            for (const item of formDataDescriptor) {
              if (!Array.isArray(item) || item.length < 2) continue;
              const name = String(item[0] || 'file');
              const spec = String(item[1] || '');
              const filenameHint = item[2] ? String(item[2]) : undefined;
              if (/^(https?:\/\/|url:)/i.test(spec)) {
                const url = spec.replace(/^url:/i, '');
                const resp = await fetch(url);
                const blob = await resp.blob();
                const fn =
                  filenameHint || url.split('?')[0].split('#')[0].split('/').pop() || 'file';
                fd.append(name, blob, fn);
              } else if (/^base64:/i.test(spec)) {
                const b64 = spec.replace(/^base64:/i, '');
                const blob = base64ToBlob(b64);
                fd.append(name, blob, filenameHint || 'file');
              } else if (/^file:/i.test(spec)) {
                const p = spec.replace(/^file:/i, '');
                const res = await readFileBase64(p);
                if (res && res.base64) {
                  const blob = base64ToBlob(res.base64);
                  fd.append(name, blob, filenameHint || res.fileName || 'file');
                }
              } else {
                // treat as string field
                fd.append(name, spec);
              }
            }
          } else if (typeof formDataDescriptor === 'object') {
            const fds = formDataDescriptor;
            const fields = fds.fields || {};
            const files = Array.isArray(fds.files) ? fds.files : [];
            for (const [k, v] of Object.entries(fields)) fd.append(String(k), String(v));
            for (const file of files) {
              const name = String(file.name || 'file');
              if (file.fileUrl) {
                const resp = await fetch(String(file.fileUrl));
                const blob = await resp.blob();
                const fn =
                  file.filename ||
                  String(file.fileUrl).split('?')[0].split('#')[0].split('/').pop() ||
                  'file';
                fd.append(name, blob, fn);
              } else if (file.base64Data) {
                const blob = base64ToBlob(
                  String(file.base64Data),
                  String(file.contentType || 'application/octet-stream'),
                );
                fd.append(name, blob, file.filename || 'file');
              } else if (file.filePath) {
                const res = await readFileBase64(String(file.filePath));
                if (res && res.base64) {
                  const blob = base64ToBlob(
                    res.base64,
                    String(file.contentType || 'application/octet-stream'),
                  );
                  fd.append(name, blob, file.filename || res.fileName || 'file');
                }
              }
            }
          }
        } catch (e) {
          console.warn('Failed to construct FormData:', e);
        }
        // Let browser set the correct multipart boundary
        try {
          if (options.headers) {
            delete options.headers['content-type'];
            delete options.headers['Content-Type'];
          }
        } catch {}
        options.body = fd;
      } else if (method !== 'GET' && method !== 'HEAD' && body !== undefined) {
        // Fallback to raw body
        options.body = body;
      }

      // 创建一个带超时的 fetch
      const fetchWithTimeout = async (url, options, timeout) => {
        const controller = new AbortController();
        const signal = controller.signal;

        // 设置超时
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        try {
          const response = await fetch(url, { ...options, signal });
          clearTimeout(timeoutId);
          return response;
        } catch (error) {
          clearTimeout(timeoutId);
          throw error;
        }
      };

      // 发送带超时的请求
      const response = await fetchWithTimeout(url, options, timeout);

      // Process response
      const responseData = {
        status: response.status,
        statusText: response.statusText,
        headers: {},
      };

      // Get response headers
      response.headers.forEach((value, key) => {
        responseData.headers[key] = value;
      });

      // Try to get response body based on content type
      const contentType = response.headers.get('content-type') || '';

      try {
        if (contentType.includes('application/json')) {
          responseData.body = await response.json();
        } else if (
          contentType.includes('text/') ||
          contentType.includes('application/xml') ||
          contentType.includes('application/javascript')
        ) {
          responseData.body = await response.text();
        } else {
          // For binary data, just indicate it was received but not parsed
          responseData.body = '[Binary data not displayed]';
        }
      } catch (error) {
        responseData.body = `[Error parsing response body: ${error.message}]`;
      }

      return {
        success: true,
        response: responseData,
      };
    } catch (error) {
      console.error('Error replaying request:', error);
      return {
        success: false,
        error: `Error replaying request: ${error.message}`,
      };
    }
  }

  // Listen for messages from the extension
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    // Respond to ping message
    if (request.action === 'chrome_network_request_ping') {
      sendResponse({ status: 'pong' });
      return false; // Synchronous response
    } else if (request.action === 'sendPureNetworkRequest') {
      replayNetworkRequest(
        request.url,
        request.method,
        request.headers,
        request.body,
        request.timeout,
        request.formData,
      )
        .then(sendResponse)
        .catch((error) => {
          sendResponse({
            success: false,
            error: `Unexpected error: ${error.message}`,
          });
        });
      return true; // Indicates async response
    }
  });
}
