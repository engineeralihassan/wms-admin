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
  styleUrl: './card.component.scss',
})
export class CardComponent {
  readonly title = input<string>('');
}
