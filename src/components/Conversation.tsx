import {
  ArrowRight,
  ArrowUp,
  Check,
  CheckCheck,
  ChevronDown,
  Hand,
  Link2,
  RotateCcw,
  SquareArrowOutUpRight,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { phaseLabel, type Agent } from "../demo";
import { Mark } from "./ui";

type Props = {
  agent: Agent;
  onSend: (text: string) => void;
  onTakeControl: () => void;
  onResume: () => void;
  onCapability: () => void;
  onReplay: () => void;
};

export function Conversation({
  agent,
  onSend,
  onTakeControl,
  onResume,
  onCapability,
  onReplay,
}: Props) {
  const [draft, setDraft] = useState("");
  const [stepsOpen, setStepsOpen] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const empty = agent.phase === "new";
  const complete = ["ready", "finished", "replaying"].includes(agent.phase);
  const statement = agent.kind === "statement";
  useEffect(() => {
    setDraft("");
  }, [agent.id]);
  useEffect(() => {
    if (agent.messages.length)
      scroll.current?.scrollTo({
        top: scroll.current.scrollHeight,
        behavior: "instant",
      });
  }, [agent.messages.length]);
  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!draft.trim()) return;
    onSend(draft.trim());
    setDraft("");
  }

  return (
    <section
      className="conversation"
      aria-label={`Conversation with ${agent.name}`}
    >
      <header className="conversation-header">
        <div>
          <h1>{agent.name}</h1>
          <span>{empty ? "Start with an outcome." : agent.description}</span>
        </div>
        <span
          className={`phase-pill ${agent.phase === "waiting" || agent.phase === "human" ? "attention" : ""}`}
        >
          <span />
          {phaseLabel(agent.phase)}
        </span>
      </header>
      <div className="conversation-scroll" ref={scroll}>
        {empty ? (
          <div className="welcome">
            <div className="welcome-mark">
              <Mark />
            </div>
            <span className="eyebrow">YOUR NEXT CAPABILITY STARTS HERE</span>
            <h2>What’s the task?</h2>
            <p>A website. An outcome. A little help when it needs you.</p>
            <button
              className="starter"
              onClick={() => {
                setDraft(
                  "Find member 10482 and prepare a savings account. Stop before submitting.",
                );
                input.current?.focus();
              }}
            >
              <span>Try the onboarding demo</span>
              <ArrowRight size={16} />
            </button>
          </div>
        ) : (
          <>
            <div className="date-divider">
              <span>Today</span>
              <span>Local preview</span>
            </div>
            <article className="user-message">
              <div className="message-person">
                <span>You</span>
                <span>Just now</span>
              </div>
              <p>
                {statement
                  ? "Find the latest savings statement for member 10482."
                  : "Find member 10482 and prepare a savings account. Stop before submitting."}
              </p>
              <div className="website-chip">
                <GlobeIcon />
                <span>demo.awl.local</span>
              </div>
            </article>
            <article className="assistant-message">
              <div className="assistant-heading">
                <span className="assistant-avatar">
                  <Mark />
                </span>
                <strong>awl</strong>
                <span>Discovery</span>
              </div>
              <p>
                {statement
                  ? "I’ll find the member, open their statements, and locate the most recent one."
                  : "I’ll find the member and prepare the account. I’ll leave the final submission to you."}
              </p>
              <div className="activity-block">
                <button
                  className="activity-toggle"
                  aria-expanded={stepsOpen}
                  onClick={() => setStepsOpen(!stepsOpen)}
                >
                  <span>
                    <span className="activity-track-icon">
                      <CheckCheck size={15} />
                    </span>
                    {complete ? "4 steps completed" : "3 steps completed"}
                  </span>
                  <ChevronDown
                    size={14}
                    className={!stepsOpen ? "closed" : ""}
                  />
                </button>
                {stepsOpen && (
                  <ol className="step-list">
                    <li>
                      <Check size={13} />
                      <span>Opened member services</span>
                      <span>01</span>
                    </li>
                    <li>
                      <Check size={13} />
                      <span>Found member 10482</span>
                      <span>02</span>
                    </li>
                    <li>
                      <Check size={13} />
                      <span>
                        {statement
                          ? "Opened account statements"
                          : "Selected everyday savings"}
                      </span>
                      <span>03</span>
                    </li>
                    {complete && (
                      <li>
                        <Check size={13} />
                        <span>
                          {statement
                            ? "Located latest statement"
                            : "Reached the review screen"}
                        </span>
                        <span>04</span>
                      </li>
                    )}
                  </ol>
                )}
              </div>
            </article>
            {(agent.phase === "waiting" || agent.phase === "human") && (
              <article
                className={`handoff-card ${agent.phase === "human" ? "is-human" : ""}`}
              >
                <div className="handoff-title">
                  <div className="handoff-icon">
                    <Hand size={18} strokeWidth={1.7} />
                  </div>
                  <span>
                    {agent.phase === "human"
                      ? "Over to you."
                      : "A little help here."}
                  </span>
                  <span className="handoff-step">STEP 04</span>
                </div>
                <p>
                  {agent.phase === "human"
                    ? "You have the browser. Confirm the member’s details on the right, then hand it back."
                    : "This step needs a staff confirmation. Take control of the browser to review the member’s details."}
                </p>
                <div className="handoff-reassurance">
                  <span className="small-square" />
                  {agent.phase === "human"
                    ? "Automation paused while you work"
                    : "Your session stays exactly where it is"}
                </div>
                <button
                  className="primary-button"
                  onClick={agent.phase === "human" ? onResume : onTakeControl}
                  disabled={agent.phase === "human" && !agent.verified}
                >
                  {agent.phase === "human" ? "Resume with awl" : "Take control"}
                  <ArrowRight size={15} />
                </button>
              </article>
            )}
            {complete && (
              <article className="completion-card">
                <div className="completion-title">
                  <CheckCheck size={18} />
                  <strong>
                    {agent.phase === "replaying"
                      ? "Running the saved steps."
                      : agent.phase === "ready"
                        ? "That’s a workflow worth keeping."
                        : "Done. And ready for next time."}
                  </strong>
                </div>
                <p>
                  {statement
                    ? "The latest statement was located. The same steps can be reused for another member."
                    : "The account request is ready for review. Your confirmation is recorded as a handoff checkpoint."}
                </p>
                <button className="saved-capability" onClick={onCapability}>
                  <span className="capability-mini-icon">
                    <SquareArrowOutUpRight size={16} />
                  </span>
                  <span>
                    <strong>
                      {statement
                        ? "Find latest statement"
                        : "Prepare savings account"}
                    </strong>
                    <small>Reusable capability · v1 · demo</small>
                  </span>
                  <ArrowRight size={15} />
                </button>
                <button
                  className="text-button"
                  onClick={onReplay}
                  disabled={agent.phase === "replaying"}
                >
                  <RotateCcw size={13} />
                  {agent.phase === "replaying"
                    ? "Replaying demo…"
                    : "Try a replay without the model"}
                </button>
              </article>
            )}
            <div className="run-end">
              <span />
              <span>
                {complete ? "Workflow captured" : "Waiting for your input"}
              </span>
            </div>
          </>
        )}
        {agent.messages.map((message) => (
          <article
            key={message.id}
            className={
              message.role === "user"
                ? "user-message additional-message"
                : "assistant-message additional-message"
            }
          >
            <div className="message-person">
              <strong>{message.role === "user" ? "You" : "awl"}</strong>
              <span>
                {message.role === "assistant" ? "Preview response" : "Just now"}
              </span>
            </div>
            <p>{message.text}</p>
          </article>
        ))}
      </div>
      <div className="composer-area">
        <form className="composer" onSubmit={submit}>
          <label className="sr-only" htmlFor="message">
            Message your agent
          </label>
          <textarea
            id="message"
            ref={input}
            placeholder={
              empty
                ? "Tell awl what you want to get done…"
                : "Give a little direction…"
            }
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={2}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                submit();
              }
            }}
          />
          <div className="composer-bottom">
            <span className="composer-context">
              <span className="small-square" />
              {empty
                ? "New session"
                : complete
                  ? "Saved workflow"
                  : "Learning this workflow"}
            </span>
            <button
              className="send-button"
              type="submit"
              aria-label="Send message"
              disabled={!draft.trim()}
            >
              <ArrowUp size={18} />
            </button>
          </div>
        </form>
        <div className="composer-footnote">
          <span>Interface preview · no AI calls</span>
          <span>
            ↵ send <span className="footnote-separator">/</span> ⇧↵ new line
          </span>
        </div>
      </div>
    </section>
  );
}

function GlobeIcon() {
  return <Link2 size={13} />;
}
