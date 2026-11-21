import { Link, useLocation, useNavigate } from "react-router-dom";
import { useMemo } from "react";
import { useFamilies, useSurveys } from "../api/queries";
import type { StateContext, SurveysResponse } from "../api/types";
import { isOffered } from "../context/levels";
import { readLastContext } from "../context/lastContext";
import { contextParts } from "../context/summary";
import { serialiseContext, useDashboardContext } from "../context/urlContext";
import barStyles from "../context/ContextBar.module.css";
import { Mark } from "../shell/Mark";
import { FamilyPreview } from "./FamilyPreview";
import styles from "./HomePage.module.css";

function Chips({ ctx, surveys }: { ctx: StateContext; surveys: SurveysResponse }) {
  return (
    <span className={styles.chips}>
      {contextParts(ctx, surveys).map((p, i) => (
        <span key={p.kind} className={barStyles.chip} data-kind={p.kind} style={{ "--i": i } as React.CSSProperties}>{p.text}</span>
      ))}
    </span>
  );
}

const STEPS = [
  { title: "Set the context", text: "Pick the state, survey level and rounds once. Every card reads from them, and the top bar edits them later." },
  { title: "Add cards", text: "Each card family answers a different question of the same survey data. Configure one and it runs on your context." },
  { title: "Arrange tabs", text: "Drag, resize and group cards into tabs on a canvas that is kept in this browser." },
] as const;

/** Where the brand leads: start a context, or pick up the one already open. */
export function HomePage() {
  const { ctx } = useDashboardContext();
  const { search } = useLocation();
  const navigate = useNavigate();
  const current = useSurveys(ctx?.state ?? null);
  const last = useMemo(readLastContext, []);
  const lastSurveys = useSurveys(ctx === null ? last?.state ?? null : null);
  const resume = ctx !== null && current.data !== undefined ? { ctx, surveys: current.data }
    : last !== null && lastSurveys.data !== undefined && isOffered(last, lastSurveys.data) ? { ctx: last, surveys: lastSurveys.data } : null;
  const families = useFamilies();

  return (
    <div className={styles.home}>
      <section className={styles.hero} aria-labelledby="home-title">
        <Mark className={styles.mark} onDark />
        <h1 id="home-title" className={styles.title}>Your survey workspace</h1>
        <p className={styles.lead}>
          Choose a state, survey level and rounds once, then build a canvas of cards that all read from that context.
        </p>
        {/* A sketch of the canvas to come: three cards, drawn from the same hues as the top bar. */}
        <div className={styles.sketch} aria-hidden="true">
          <i data-tone="saffron"><b /><b /><b /></i>
          <i data-tone="mint"><b /><b /><b /></i>
          <i data-tone="sky"><b /><b /><b /></i>
        </div>
        <div className={styles.actions}>
          <Link className={styles.primary} to={{ pathname: "/" }}>
            Set up context
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 8h9M8.5 4l4 4-4 4" />
            </svg>
          </Link>
        </div>
      </section>

      {resume !== null && (
        <section className={styles.resume} aria-label="Resume">
          <div className={styles.resumeText}>
            <h2 className={styles.h2}>{ctx !== null ? "Continue where you are" : "Pick up where you left off"}</h2>
            <Chips ctx={resume.ctx} surveys={resume.surveys} />
          </div>
          <button type="button" className={styles.secondary}
            onClick={() => navigate({ pathname: "/", search: ctx !== null ? search : `?${serialiseContext(resume.ctx).toString()}` })}>
            Open workspace
          </button>
        </section>
      )}

      {families.data !== undefined && families.data.length > 0 && (
        <section aria-labelledby="home-glimpse" className={styles.glimpse}>
          <div className={styles.glimpseHead}>
            <h2 id="home-glimpse" className={styles.h2}>A glimpse of the cards</h2>
            <p className={styles.note}>Drawn with placeholders: these show how each card reads, never what a survey found.</p>
          </div>
          <ul className={styles.tiles}>
            {families.data.map((d, i) => (
              <li key={d.family} className={`${styles.tile} mb-tile`} style={{ "--i": i } as React.CSSProperties}>
                <FamilyPreview family={d.family} />
                <h3 className={styles.tileTitle}>{d.label}</h3>
                <p className={styles.tileText}>{d.description}</p>
              </li>
            ))}
            <li className={`${styles.tile} ${styles.ctaTile}`} style={{ "--i": families.data.length } as React.CSSProperties}>
              <h3 className={styles.tileTitle}>Your canvas</h3>
              <p className={styles.tileText}>Mix any of these on tabs, each reading from the context you set once.</p>
              <Link className={styles.primary} to={{ pathname: "/" }}>Start with a state</Link>
            </li>
          </ul>
        </section>
      )}

      <section aria-labelledby="home-how" className={styles.how}>
        <h2 id="home-how" className={styles.h2}>How it works</h2>
        <ol className={styles.steps}>
          {STEPS.map((s, i) => (
            <li key={s.title} className={styles.step} style={{ "--i": i } as React.CSSProperties}>
              <span className={styles.stepNo} aria-hidden="true">{i + 1}</span>
              <div>
                <h3 className={styles.stepTitle}>{s.title}</h3>
                <p className={styles.stepText}>{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <p className={styles.trust}>
        The engine computes every number; this page only arranges them. A value that is missing shows as a dash, with the reason on hover.
      </p>
    </div>
  );
}
