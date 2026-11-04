import { useState } from 'react';
import { download } from './lib';

export function AttachmentDownload({ value }: { value: string }) {
  if (!value) return null;
  const file = JSON.parse(value) as { name: string; content: string };
  return (
    <button
      type="button"
      onClick={() => {
        const bytes = Uint8Array.from(atob(file.content), (ch) => ch.charCodeAt(0));
        download(file.name, new Blob([bytes], { type: 'application/octet-stream' }));
      }}
    >
      Download {file.name}
    </button>
  );
}

export function AttachmentField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [error, setError] = useState('');
  return (
    <div className="attachment-field">
      <label>
        Attachment (PDF, PNG or JPEG, up to 32 KiB)
        <input
          type="file"
          accept="application/pdf,image/png,image/jpeg"
          disabled={disabled}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            setError('');
            if (
              file.size > 32768 ||
              !['application/pdf', 'image/png', 'image/jpeg'].includes(file.type)
            ) {
              setError('Choose a PDF, PNG, or JPEG up to 32 KiB.');
              return;
            }
            try {
              const bytes = new Uint8Array(await file.arrayBuffer());
              onChange(
                JSON.stringify({
                  name: file.name,
                  mime: file.type,
                  content: btoa(String.fromCharCode(...bytes)),
                }),
              );
            } catch {
              setError('Could not read that file.');
            }
          }}
        />
      </label>
      {value && (
        <div className="actions">
          <AttachmentDownload value={value} />
          <button type="button" disabled={disabled} onClick={() => onChange('')}>
            Remove attachment
          </button>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
