import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { SETTINGS_NAV } from '../settings-nav';

@Component({
  selector: 'app-settings-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './settings-layout.component.html',
  styleUrl: './settings-layout.component.scss',
})
export class SettingsLayoutComponent {
  protected readonly navItems = SETTINGS_NAV;
}
