import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library only auto-cleans with vitest globals; unmount every render explicitly.
afterEach(() => cleanup());
