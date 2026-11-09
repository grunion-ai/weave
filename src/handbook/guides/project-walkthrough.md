# A project and its linked work

Start in [[table:Showcase/Projects|Projects]]. In the public Showcase, **Apollo Launch** is an example project. Its **Tasks** relation connects the project to work in [[table:Showcase/Tasks|Tasks]]. Open a task and follow **Project** back to its parent. The two tables describe the same work at different levels.

## Read the fields, then follow the context

A task's **Status** describes its progress; **Due** and **Assignee** answer when and who. The project's **Stage** describes the project as a whole. A task status does not automatically change the project stage.

Open **Everything Apollo** in [[table:Showcase/Notes|Notes]]. Its **Related** field can point to projects, meetings, documents, tables, and spaces. A note can hold context that belongs to several kinds of record without copying that context into each one. Read the **Polymorphic relations** guide for the field configuration and its limits.

## See a value calculated from linked records

Open [[table:Showcase/Expenses|Expenses]] and inspect **Line total**. It sums **Amount** from linked [[table:Showcase/Line Items|Line Items]]. A line item's **Expense category** is a lookup from its expense. Follow the relation to see where the value comes from.

[[table:Handbook/Fields|The field reference]] explains relation, lookup, and rollup configuration.

## Try the structure in your workspace

Browse these public records as examples. To start your own data, use the native **Use template** action on [[space:CRM|CRM]] or [[space:Money|Money]]. The schema is copied; example records and attachments are not. You need architect access to the destination workspace.

For a project structure, ask your agent to propose Projects and Tasks with a relation between them, inspect its dry run, then build in your own workspace. Give it the **Agent access (MCP)** guide and ask it to read your workspace outline first.
