# Diagrams

```mermaid
graph TD
  W[Workspace] --> S[Space]
  S --> T[Table]
  T --> E[Entity]
  E --> D[Document]
  E --> F[Field value]
  T -. relation .-> T
```

A state machine:

```mermaid
stateDiagram-v2
  [*] --> Backlog
  Backlog --> Building
  Building --> Shipped
  Building --> Dropped
  Shipped --> [*]
```

Both render in the editor, in the rendered view, and in every export. `.mmd` is a first-class download format beside `.md`, `.html` and `.pdf`.

Graphviz, PlantUML, echarts, mindmap, abc and flowchart fences degrade to plain code blocks on purpose — six more renderers is not worth six more vendored bundles.