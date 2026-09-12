import { ArrowRight, Code2 } from "lucide-react";
import { useState } from "react";
import { demoCapabilities, type CapabilityRun } from "../demo";
import "./capabilities.css";

export function Capabilities({
  onRun,
}: {
  onRun: (run: CapabilityRun) => void;
}) {
  const [inputs, setInputs] = useState<Record<string, string>>({});

  return (
    <section
      id="capabilities-view"
      role="tabpanel"
      aria-labelledby="capabilities-tab"
      className="capabilities-library"
    >
      <div className="capabilities-content">
        <header className="capabilities-heading">
          <h1>Capabilities</h1>
          <p>Pick a workflow. Add its inputs. Run it in a new chat.</p>
        </header>
        <div className="capabilities-list">
          {demoCapabilities.map((capability) => (
            <article className="capability-entry" key={capability.id}>
              <div className="capability-entry-heading">
                <Code2 size={19} />
                <h2>{capability.name}</h2>
                <span>v{capability.version}</span>
              </div>
              <p>{capability.description}</p>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const memberId = inputs[capability.id]?.trim();
                  if (!memberId) return;
                  onRun({
                    capability: structuredClone(capability),
                    inputs: { member_id: memberId },
                  });
                }}
              >
                <div className="capability-input">
                  <label htmlFor={`input-${capability.id}`}>Member ID</label>
                  <input
                    id={`input-${capability.id}`}
                    required
                    maxLength={100}
                    autoComplete="off"
                    placeholder="e.g. 10482"
                    value={inputs[capability.id] ?? ""}
                    onChange={(event) =>
                      setInputs({
                        ...inputs,
                        [capability.id]: event.target.value,
                      })
                    }
                  />
                </div>
                <button
                  type="submit"
                  className="primary-button"
                  aria-label={`Run ${capability.name}`}
                  disabled={!inputs[capability.id]?.trim()}
                >
                  Run <ArrowRight size={15} />
                </button>
              </form>
            </article>
          ))}
        </div>
        <p className="capabilities-note">
          Demo capabilities · Runs simulate progress without operating the
          browser.
        </p>
      </div>
    </section>
  );
}
