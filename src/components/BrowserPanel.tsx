import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Code2,
  FileText,
  Globe2,
  Hand,
  LockKeyhole,
  Monitor,
  MousePointer2,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { capabilityCode, type Agent } from "../demo";
import { IconButton, StatusDot } from "./ui";

type Props = {
  agent: Agent;
  tab: "browser" | "capability";
  setTab: (tab: "browser" | "capability") => void;
  onTakeControl: () => void;
  onVerify: (verified: boolean) => void;
  onResume: () => void;
  onReplay: () => void;
  onReset: () => void;
};

export function BrowserPanel({
  agent,
  tab,
  setTab,
  onTakeControl,
  onVerify,
  onResume,
  onReplay,
  onReset,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [reviewPrepared, setReviewPrepared] = useState(false);
  const finished = ["ready", "finished", "replaying"].includes(agent.phase);
  const empty = agent.phase === "new";
  const statement = agent.kind === "statement";
  async function copyCapability() {
    try {
      await navigator.clipboard.writeText(capabilityCode(agent.kind));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="browser-panel" aria-label="Session workspace">
      <header className="panel-header">
        <div className="view-tabs" aria-label="Session views">
          <button
            aria-pressed={tab === "browser"}
            onClick={() => setTab("browser")}
          >
            <Globe2 size={15} />
            Browser
          </button>
          <button
            aria-pressed={tab === "capability"}
            onClick={() => setTab("capability")}
          >
            <Code2 size={15} />
            Capability{finished && <span className="tab-dot" />}
          </button>
        </div>
        <span className="sample-label">DEMO</span>
      </header>

      {tab === "capability" ? (
        <div className="capability-view">
          <div className="capability-icon">
            <Code2 size={25} strokeWidth={1.5} />
          </div>
          <span className="eyebrow">
            {finished ? "SAVED CAPABILITY" : "CAPABILITY PREVIEW"}
          </span>
          <h2>{statement ? "Find a statement." : "Learn once. Run again."}</h2>
          <p>
            {finished
              ? "The workflow has a shape now. New inputs, the same verified steps."
              : "A successful run becomes a reusable workflow. Finish the handoff to see the saved state."}
          </p>
          <div className="code-card">
            <div className="code-header">
              <span>
                {statement
                  ? "find_latest_statement"
                  : "prepare_savings_account"}
              </span>
              <span>v1 · {finished ? "saved" : "draft"}</span>
            </div>
            <pre>{capabilityCode(agent.kind)}</pre>
          </div>
          <div className="capability-actions">
            <button
              className="primary-button"
              disabled={!finished || agent.phase === "replaying"}
              onClick={onReplay}
            >
              <RotateCcw size={15} />
              {agent.phase === "replaying" ? "Replaying demo…" : "Try a replay"}
            </button>
            <button className="text-button" onClick={copyCapability}>
              {copied ? "Copied" : "Copy preview"}
            </button>
          </div>
          <p className="prototype-note">
            Illustrative contract. No code is generated or executed in this
            preview.
          </p>
        </div>
      ) : (
        <>
          <div className="address-bar">
            <div className="browser-nav">
              <IconButton label="Back" disabled>
                <ArrowLeft size={15} />
              </IconButton>
              <IconButton label="Forward" disabled>
                <ArrowRight size={15} />
              </IconButton>
            </div>
            <div className="address">
              <LockKeyhole size={12} />
              <span>
                {empty
                  ? "No website selected"
                  : `demo.awl.local/members/10482/${statement ? "statements" : "accounts/new"}`}
              </span>
            </div>
            <IconButton
              label="Reset demo session"
              onClick={() => {
                setReviewPrepared(false);
                onReset();
              }}
              disabled={empty}
            >
              <RotateCcw size={14} />
            </IconButton>
          </div>
          <div
            className={`control-strip ${agent.phase === "human" ? "human" : ""}`}
          >
            <span>
              {agent.phase === "human" ? (
                <Hand size={14} />
              ) : (
                <MousePointer2 size={14} />
              )}
              {empty
                ? "Your browser will appear here"
                : agent.phase === "human"
                  ? "You’re in control"
                  : agent.phase === "waiting"
                    ? "Paused for your input"
                    : agent.phase === "replaying"
                      ? "Replaying saved steps"
                      : "Session complete"}
            </span>
            {!empty && (
              <span className="control-detail">
                {agent.phase === "human" ? "Capture paused" : "Local session"}
              </span>
            )}
          </div>
          {empty ? (
            <div className="browser-empty">
              <div className="empty-browser-icon">
                <Monitor size={32} strokeWidth={1} />
              </div>
              <h2>A place to get things done.</h2>
              <p>
                Give your agent a goal. Its browser session will live right
                here.
              </p>
              <span className="mono">YOU + AWL, SAME SESSION</span>
            </div>
          ) : (
            <div className="browser-viewport">
              <div className="portal-topbar">
                <div className="portal-brand">
                  <span className="portal-symbol">
                    <span />
                    <span />
                    <span />
                  </span>
                  Member services
                </div>
                <span className="portal-staff">Staff workspace</span>
              </div>
              <div className="portal-content">
                <div className="breadcrumbs">
                  Members
                  <ChevronRight size={12} />
                  <span>10482</span>
                  <ChevronRight size={12} />
                  <span>{statement ? "Statements" : "New account"}</span>
                </div>
                <div className="portal-heading">
                  <span className="eyebrow">MEMBER 10482</span>
                  <h2>
                    {statement
                      ? "Account statements"
                      : "Open a savings account"}
                  </h2>
                  <p>
                    {statement
                      ? "View and retrieve this member’s statements."
                      : "Review the member and account details below."}
                  </p>
                </div>
                <div className="member-summary">
                  <div className="member-avatar">AM</div>
                  <div>
                    <strong>Alex Morgan</strong>
                    <span>Member since 2021</span>
                  </div>
                  <span className="member-active">
                    <StatusDot />
                    Active
                  </span>
                </div>

                {statement ? (
                  <div className="statement-card">
                    <FileText size={28} strokeWidth={1.25} />
                    <div>
                      <strong>August 2026</strong>
                      <span>Savings · ending in 4820</span>
                    </div>
                    <span className="document-tag">PDF</span>
                  </div>
                ) : (
                  <>
                    <div className="portal-section-title">
                      <span>Account details</span>
                      <span>01 / 02</span>
                    </div>
                    <div className="account-fields">
                      <div>
                        <label htmlFor="account-type">Account type</label>
                        <div id="account-type" className="mock-field">
                          Everyday savings<span>USD</span>
                        </div>
                      </div>
                      <div>
                        <label htmlFor="ownership">Ownership</label>
                        <div id="ownership" className="mock-field">
                          Individual
                        </div>
                      </div>
                    </div>
                    <div
                      className={`verification ${agent.verified ? "verified" : ""}`}
                    >
                      <div className="verification-heading">
                        <ShieldCheck size={19} strokeWidth={1.5} />
                        <strong>
                          {agent.verified
                            ? "Member details confirmed"
                            : "Staff confirmation required"}
                        </strong>
                        {agent.verified && <Check size={16} />}
                      </div>
                      <p>
                        {agent.verified
                          ? "The request can move to the review screen."
                          : "Confirm the member’s details before preparing this account request."}
                      </p>
                      <label className="confirmation-checkbox">
                        <input
                          type="checkbox"
                          checked={agent.verified}
                          disabled={agent.phase !== "human"}
                          onChange={(event) => {
                            setReviewPrepared(false);
                            onVerify(event.target.checked);
                          }}
                        />
                        <span>I have reviewed the member’s details</span>
                      </label>
                    </div>
                    <div className="portal-bottom">
                      <span>
                        <LockKeyhole size={13} />
                        Nothing has been submitted
                      </span>
                      <button
                        className="portal-button"
                        disabled={
                          agent.phase !== "human" ||
                          !agent.verified ||
                          reviewPrepared
                        }
                        onClick={() => setReviewPrepared(true)}
                      >
                        {reviewPrepared
                          ? "Review prepared"
                          : "Continue to review"}
                        <ArrowRight size={14} />
                      </button>
                    </div>
                  </>
                )}
                {(finished || (reviewPrepared && agent.phase === "human")) && (
                  <div className="portal-success" role="status">
                    <Check size={16} />
                    {agent.phase === "human"
                      ? "Review ready. Hand control back when you’re done."
                      : agent.phase === "replaying"
                        ? "Replaying the sample workflow…"
                        : statement
                          ? "Latest statement located"
                          : "Request prepared. Stopped before submission."}
                  </div>
                )}
              </div>
              <div className="portal-footnote">
                Sample application · fictional member data
              </div>
            </div>
          )}
          {!empty && (
            <footer className="browser-footer">
              {agent.phase === "waiting" && (
                <button className="text-button" onClick={onTakeControl}>
                  Take control
                  <ArrowRight size={13} />
                </button>
              )}
              {agent.phase === "human" && (
                <button
                  className="text-button"
                  onClick={onResume}
                  disabled={!agent.verified}
                >
                  Hand back to awl
                  <ArrowRight size={13} />
                </button>
              )}
            </footer>
          )}
        </>
      )}
    </section>
  );
}
