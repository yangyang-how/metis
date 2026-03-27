---
description: Test atom extraction on a sample passage
argument-hint: [path-to-text-file]
---

Run atom extraction on the provided sample text and validate results.

!`cat $ARGUMENTS`

Using the frame type taxonomy from the design docs, manually extract what
atoms SHOULD come out of this text. Then:

1. If the extraction pipeline exists, run it: `cd engine && bun run extract $ARGUMENTS`
2. Compare actual output against expected atoms
3. Check: correct frame types? one fact per role? proper source attribution?
4. Report any frame type that seems missing from the registry

If the pipeline doesn't exist yet, just produce the expected atoms as a
reference for building the extraction tests.
