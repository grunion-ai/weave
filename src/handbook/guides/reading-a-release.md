# Reading a release

[[table:Development/Release|Release notes]] explain what changed for someone using weave. Follow the linked [[table:Development/Issue|issues]] and [[table:Development/Feature|features]] for the problem, decisions, and implementation history.

A merged pull request is evidence that source code landed. Production availability is a separate step. Check deployment evidence before describing a change as available to everyone.

## What a useful release note contains

Start with the concrete behavior: what a user can now do, or what no longer goes wrong. Give one short way to try it, linked to a maintained guide or a working Showcase record. Mention any limitation that affects that example.

| Part | What to include |
| --- | --- |
| Change | The user-visible before and after. |
| Try it | A few steps and a link to a working example or guide. |
| Evidence | The issue or feature, merged change, and deployment status. |
| Checks | Relevant [[table:Quality/Suite|suites]] or [[table:Quality/Case|cases]]. |
| Limits | Permissions, migration needs, or behavior the change does not cover. |

## Keep the example useful

Link to the existing guide rather than copying its full instructions into every release. Keep historical notes about the behavior that shipped at the time. Correct inaccurate claims with a dated note, so the record still explains what changed.

Showcase examples belong in [[space:Showcase|Showcase]]. Release notes provide a route into them; they do not replace the issue, roadmap, or test documentation.
