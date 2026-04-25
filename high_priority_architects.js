// Architect names / keywords used to flag a project as "high priority".
// Match is case-insensitive substring against the "Design Architect Firm" field.
export const HIGH_PRIORITY_ARCHITECTS = [
  "perkins&will",
  "perkins & will",
  "kpmb architects",
  "kpmb",
  "architectsalliance",
  "architects—alliance",
  "architects-alliance",
  "diamond schmitt architects",
  "diamond schmitt",
  "quadrangle",
  "bdp quadrangle",
  "ibi group",
  "arcadis",
  "hariri pontarini architects",
  "hariri pontarini"
];

export function isHighPriorityArchitect(architectField) {
  if (!architectField) return false;
  const text = architectField.toLowerCase();
  return HIGH_PRIORITY_ARCHITECTS.some((needle) => text.includes(needle));
}
