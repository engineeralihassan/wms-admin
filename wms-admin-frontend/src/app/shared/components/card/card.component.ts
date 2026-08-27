import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Generic content card with an optional title.
 * Uses content projection so any markup can be placed inside.
 */
@Component({
  selector: 'app-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card">
      @if (title()) {
        <header class="card__header">
          <h3 class="card__title">{{ title() }}</h3>
          <ng-content select="[card-actions]" />
        </header>
      }
      <div class="card__body">
        <ng-content />
      </div>
    </section>
  `,
  styles: [
    `
      .card {
        background: var(--color-surface, #fff);
        border: 1px solid var(--color-border, #e2e8f0);
        border-radius: 12px;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
        overflow: hidden;
      }
      .card__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 1rem 1.25rem;
        border-bottom: 1px solid var(--color-border, #e2e8f0);
      }
      .card__title {
        margin: 0;
        font-size: 1rem;
        font-weight: 600;
        color: var(--color-text, #0f172a);
      }
      .card__body {
        padding: 1.25rem;
      }
    `,
  ],
})
export class CardComponent {
  readonly title = input<string>('');
}
