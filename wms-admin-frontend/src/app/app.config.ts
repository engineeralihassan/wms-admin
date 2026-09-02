import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideEchartsCore } from 'ngx-echarts';

import { routes } from './app.routes';
import { authInterceptor } from './core/http/interceptors/auth.interceptor';
import { errorInterceptor } from './core/http/interceptors/error.interceptor';
import { loadingInterceptor } from './core/http/interceptors/loading.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(
      withInterceptors([loadingInterceptor, authInterceptor, errorInterceptor]),
    ),
    // ngx-echarts: lazy-load the ECharts core so it isn't in the initial bundle.
    // Every chart on the dashboard renders through the single reusable BarChart
    // component, which uses the `echarts` directive provided here.
    provideEchartsCore({ echarts: () => import('echarts') }),
  ],
};
