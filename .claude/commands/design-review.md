---
description: Check if implementation matches design documents
---

## Design Documents

Read the current design docs:

!`cat design/00-vision-and-foundations.md`
!`cat design/01-architecture.md`

## Current Implementation

!`find engine/src -name '*.ts' 2>/dev/null | head -30`
!`find engine/test -name '*.ts' 2>/dev/null | head -20`

## Review

Compare the implementation against the design docs:

1. Are pipeline stages implemented as separate modules matching the architecture?
2. Do atom types match the spec in the vision doc?
3. Are frame types registered through the registry (not ad-hoc)?
4. Does the LLM usage follow the cost profile (capable for comprehend, cheap for extract)?
5. Are there any architectural decisions in the code that contradict the design docs?

Report findings. If design docs need updating based on implementation learnings, suggest specific changes.
