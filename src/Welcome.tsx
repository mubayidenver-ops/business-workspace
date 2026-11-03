import { useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Boxes,
  FileSignature,
  Users,
  CheckCheck,
  ShieldCheck,
  Sparkles,
  Globe2,
  Layers3,
  ChevronRight,
} from 'lucide-react';
import { tools, groups } from '../shared/tools.mjs';
import { DesignerCredit } from './DesignerCredit';
export function Welcome() {
  const [group, setGroup] = useState('Clients');
  return (
    <div className="welcome-site">
      <nav className="site-nav" aria-label="Public navigation">
        <a className="site-brand" href="/">
          <span className="brandmark">
            <Boxes size={25} />
          </span>
          <span>
            business<span>workspace</span>
          </span>
        </a>
        <div className="site-nav-links">
          <a href="#how-it-works">How it works</a>
          <a href="#toolkit">Explore the toolkit</a>
        </div>
        <div className="actions">
          <a className="site-signin" href="/?auth=login">
            Sign in
          </a>
          <a className="button-link primary" href="/?auth=register">
            Start your workspace
            <ArrowUpRight size={15} />
          </a>
        </div>
      </nav>
      <main>
        <section className="site-hero">
          <div className="hero-copy">
            <span className="hero-label">
              <span /> BUILT FOR PEOPLE BUILDING SOMETHING
            </span>
            <h1>
              Less scattered.
              <br />
              More <span>possibility.</span>
            </h1>
            <p>
              Bring your client work, business tools, and next big idea into one beautifully
              organised workspace.
            </p>
            <div className="hero-actions">
              <a className="button-link primary" href="/?auth=register">
                Make room for better work
                <ArrowRight size={18} />
              </a>
              <a className="hero-secondary" href="#toolkit">
                See what’s inside
                <ChevronRight size={16} />
              </a>
            </div>
            <div className="hero-assurances">
              <span>
                <Check size={14} />
                No card needed
              </span>
              <span>
                <Check size={14} />
                Private by default
              </span>
              <span>
                <Check size={14} />
                Works in your browser
              </span>
            </div>
          </div>
          <div className="hero-workspace" aria-label="Example workflow illustration">
            <div className="workspace-demo-top">
              <span className="demo-dots">
                <i />
                <i />
                <i />
              </span>
              <span>A clearer working day</span>
              <Boxes size={16} />
            </div>
            <div className="workspace-demo-body">
              <span className="eyebrow">FROM FIRST HELLO TO FINAL DELIVERY</span>
              <h2>
                Everything moving.
                <br />
                All together.
              </h2>
              <div className="demo-workflow">
                <div>
                  <span className="demo-tool">
                    <Users size={21} />
                  </span>
                  <span>
                    <strong>A great first impression</strong>
                    <small>Collect a clear client brief</small>
                  </span>
                  <Check size={16} />
                </div>
                <div>
                  <span className="demo-tool peach">
                    <FileSignature size={21} />
                  </span>
                  <span>
                    <strong>A proposal that adds up</strong>
                    <small>Line items, tax & transparent totals</small>
                  </span>
                  <Check size={16} />
                </div>
                <div>
                  <span className="demo-tool lilac">
                    <CheckCheck size={21} />
                  </span>
                  <span>
                    <strong>A simple “let’s do it”</strong>
                    <small>Private links for client approval</small>
                  </span>
                  <ArrowUpRight size={16} />
                </div>
              </div>
              <div className="demo-footer">
                <span>
                  <ShieldCheck size={15} />
                  Your workspace stays private
                </span>
                <span>Designed to connect</span>
              </div>
            </div>
            <div className="floating-note">
              <Sparkles size={18} />
              <div>
                <strong>One less thing to juggle.</strong>
                <span>That’s a good place to start.</span>
              </div>
            </div>
          </div>
        </section>
        <section className="site-strip">
          <div>
            <Layers3 size={22} />
            <span>
              <strong>30 focused workspaces</strong>
              <small>One place to organise the work</small>
            </span>
          </div>
          <div>
            <Users size={22} />
            <span>
              <strong>Made for independents</strong>
              <small>Freelancers, consultants & small agencies</small>
            </span>
          </div>
          <div>
            <Globe2 size={22} />
            <span>
              <strong>Ready to work across borders</strong>
              <small>Browser access & currency-aware documents</small>
            </span>
          </div>
        </section>
        <section id="how-it-works" className="site-section">
          <div className="site-section-title">
            <span className="eyebrow">A WORKFLOW, NOT ANOTHER TAB</span>
            <h2>Good business is connected.</h2>
            <p>
              Start with a conversation. Keep the details, decisions, and deliverables together.
            </p>
          </div>
          <div className="site-feature-grid">
            <article>
              <span className="feature-number">01 / CONNECT</span>
              <Users size={30} />
              <h3>Make the first hello count.</h3>
              <p>
                Share a project brief with your client. Their response arrives right inside your
                workspace.
              </p>
              <span className="feature-pill">Public onboarding briefs</span>
            </article>
            <article>
              <span className="feature-number">02 / CREATE</span>
              <FileSignature size={30} />
              <h3>Put a clear offer on the table.</h3>
              <p>
                Build itemised proposals with discounts and tax. Give clients a polished document
                they can review.
              </p>
              <span className="feature-pill">Itemised proposals & invoices</span>
            </article>
            <article>
              <span className="feature-number">03 / DELIVER</span>
              <CheckCheck size={30} />
              <h3>Move forward with a decision.</h3>
              <p>
                Clients can approve or request changes through an expiring link. Turn your proposal
                into an invoice draft.
              </p>
              <span className="feature-pill">Client approvals & private links</span>
            </article>
          </div>
        </section>
        <section id="toolkit" className="site-section toolkit-section">
          <div className="site-section-title">
            <span className="eyebrow">A HOME FOR THE REST OF YOUR DAY</span>
            <h2>
              Your next useful tool
              <br />
              is already here.
            </h2>
            <p>
              Organise clients, prepare documents, clean files, and keep an eye on your websites.
            </p>
          </div>
          <div className="category-tabs">
            {groups.map((g) => (
              <button
                key={g}
                className={group === g ? 'active' : ''}
                aria-pressed={group === g}
                onClick={() => setGroup(g)}
              >
                {g}
              </button>
            ))}
          </div>
          <div className="site-tool-grid">
            {tools
              .filter((t) => t.group === group)
              .map((t) => (
                <article key={t.id}>
                  <span className="card-category">{t.group}</span>
                  <h3>{t.name}</h3>
                  <p>{t.description}</p>
                  <a href="/?auth=register">
                    Explore workspace
                    <ArrowUpRight size={15} />
                  </a>
                </article>
              ))}
          </div>
          <p className="site-capability-note">
            An evolving product, with clear capabilities. Payments require merchant activation.
            Automatic AI/media processing, team access, and some integrations are not connected yet.
            Website monitoring pauses when free hosting sleeps.
          </p>
        </section>
        <section className="site-last-call">
          <span className="eyebrow">GIVE YOUR BUSINESS A LITTLE MORE SPACE</span>
          <h2>
            Big ambitions.
            <br />A calmer way to get there.
          </h2>
          <p>Start with one project. Build your own way of working.</p>
          <a href="/?auth=register" className="button-link primary">
            Create your workspace
            <ArrowRight size={17} />
          </a>
          <span className="small muted">Development preview · No subscription billing enabled</span>
        </section>
      </main>
      <footer className="site-footer">
        <div>
          <a className="site-brand" href="/">
            <span className="brandmark">
              <Boxes size={23} />
            </span>
            Business Workspace
          </a>
          <p>Good things happen when work comes together.</p>
        </div>
        <DesignerCredit />
        <a href="/?auth=login">
          Open your workspace
          <ArrowUpRight size={14} />
        </a>
      </footer>
    </div>
  );
}
