import dictionary from "grove:english";
import { createEnglishChecker } from "./core.ts";

// Imported on first eligible edit, not during authentication or ordinary search.
export const englishChecker = createEnglishChecker(dictionary);
