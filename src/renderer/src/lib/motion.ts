/** Die eine Kurve fuer Bewegungen der App (interaction.css: --ease). */
export const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)'

/** Wer weniger Bewegung will, bekommt Blenden statt Wegen. Bei jedem Aufruf neu gefragt: die Einstellung kann sich aendern. */
export const reduced = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches
