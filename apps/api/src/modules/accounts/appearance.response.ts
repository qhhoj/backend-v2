import type {
  AppearanceAccent,
  AppearanceBackground,
  AppearanceContrast,
} from './appearance';

export class AppearanceResponse {
  /** Accent preset. */
  accent!: AppearanceAccent;
  /** Contrast level; absent means `standard`. */
  contrast?: AppearanceContrast;
  /** Page background style; absent means the default (`blueprint`). */
  background?: AppearanceBackground;
}
