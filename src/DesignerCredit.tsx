import { useState } from 'react';
import { ArrowUpRight, Github, PenTool } from 'lucide-react';
import { Modal } from './ui';

export function DesignerCredit() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className="designer-credit" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <PenTool size={14} aria-hidden="true" />
        <span>
          Designed by <strong>lordyvites</strong>
        </span>
        <ArrowUpRight size={13} aria-hidden="true" />
      </button>
      {open && (
        <Modal title="About the designer" onClose={() => setOpen(false)}>
          <div className="modal-body designer-profile">
            <div className="designer-heading">
              <span className="designer-monogram" aria-hidden="true">
                lv
              </span>
              <div>
                <span className="eyebrow">THE NAME BEHIND THE DESIGN</span>
                <h3>lordyvites</h3>
                <p className="muted">Business Workspace</p>
              </div>
            </div>
            <p>
              One app bringing everyday business tools together for people working across countries.
            </p>
            <dl className="settings-list">
              <div>
                <dt>Designer name</dt>
                <dd>lordyvites</dd>
              </div>
              <div>
                <dt>GitHub username</dt>
                <dd>mubayidenver-ops</dd>
              </div>
              <div>
                <dt>Project</dt>
                <dd>Business Workspace</dd>
              </div>
              <div>
                <dt>Vision</dt>
                <dd>30 tools in one connected app</dd>
              </div>
              <div>
                <dt>Intended reach</dt>
                <dd>International</dd>
              </div>
            </dl>
            <div className="designer-links">
              <a
                href="https://github.com/mubayidenver-ops"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Github size={17} aria-hidden="true" />
                GitHub profile
                <ArrowUpRight size={15} aria-hidden="true" />
              </a>
              <a
                href="https://github.com/mubayidenver-ops/business-workspace"
                target="_blank"
                rel="noopener noreferrer"
              >
                Project repository
                <ArrowUpRight size={15} aria-hidden="true" />
              </a>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
