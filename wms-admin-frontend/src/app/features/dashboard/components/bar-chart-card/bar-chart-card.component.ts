import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import type { EChartsOption } from 'echarts';
import { CardComponent } from '../../../../shared/components/card/card.component';
import { ButtonComponent } from '../../../../shared/components/button/button.component';
import { SpinnerComponent } from '../../../../shared/components/spinner/spinner.component';
import type { ChartData } from '../../models/dashboard.model';

/**
 * THE single reusable bar-chart widget for the whole dashboard.
 *
 * It is fully data-driven: give it a normalized `ChartData` (same shape from every
 * backend chart endpoint) plus the loading/error flags, and it renders:
 *  - a per-widget loader while `loading` is true,
 *  - an inline error with a Retry button when `error` is true,
 *  - an empty state when there are no bars/values,
 *  - otherwise an ECharts bar chart with one colored bar per series point.
 *
 * Because the shape is identical across modules, no chart-specific code lives here —
 * leaves/tickets/expenses/projects/users/organizations all use this one component.
 */
@Component({
  selector: 'app-bar-chart-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgxEchartsDirective, CardComponent, ButtonComponent, SpinnerComponent],
  templateUrl: './bar-chart-card.component.html',
  styleUrl: './bar-chart-card.component.scss',
})
export class BarChartCardComponent {
  /** The normalized chart payload (null while first load is in flight). */
  readonly data = input<ChartData | null>(null);
  readonly loading = input<boolean>(false);
  readonly error = input<boolean>(false);

  /** Fired when the user clicks "View details" — parent handles navigation. */
  readonly viewDetails = output<string>();
  /** Fired when the user clicks "Retry" after an error. */
  readonly retry = output<void>();

  /** Title shown in the card header; falls back to a neutral label. */
  protected readonly title = computed(() => this.data()?.title ?? 'Overview');

  /** True when we have loaded data but every bar is zero (nothing to show). */
  protected readonly isEmpty = computed(() => {
    const d = this.data();
    if (!d) return false;
    return d.series.length === 0 || d.series.every((s) => s.value === 0);
  });

  /**
   * Build the ECharts option from the series. Each bar carries its own color via
   * itemStyle, so the palette is defined by the backend (module/status aware) and the
   * chart stays presentation-only.
   */
  protected readonly chartOption = computed<EChartsOption>(() => {
    const d = this.data();
    const series = d?.series ?? [];
    return {
      grid: { top: 24, right: 16, bottom: 40, left: 40, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
      },
      xAxis: {
        type: 'category',
        data: series.map((s) => s.label),
        axisTick: { alignWithLabel: true },
        axisLabel: { interval: 0, hideOverlap: true, fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
        splitLine: { lineStyle: { type: 'dashed' } },
      },
      series: [
        {
          type: 'bar',
          barMaxWidth: 44,
          itemStyle: { borderRadius: [6, 6, 0, 0] },
          label: { show: true, position: 'top', fontSize: 11 },
          data: series.map((s) => ({
            value: s.value,
            itemStyle: { color: s.color },
          })),
        },
      ],
    };
  });

  protected onViewDetails(): void {
    const path = this.data()?.detailPath;
    if (path) this.viewDetails.emit(path);
  }

  protected onRetry(): void {
    this.retry.emit();
  }
}
