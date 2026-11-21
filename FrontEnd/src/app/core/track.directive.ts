import { Directive, ElementRef, Input, OnChanges, OnDestroy, SimpleChanges, inject } from '@angular/core';
import { Track } from 'livekit-client';

@Directive({ selector: 'video[appTrack]', standalone: true })
export class TrackDirective implements OnChanges, OnDestroy {
  @Input('appTrack') track: Track | null = null;
  private el = inject<ElementRef<HTMLVideoElement>>(ElementRef);

  ngOnChanges(changes: SimpleChanges): void {
    const video = this.el.nativeElement;
    const prev = changes['track']?.previousValue as Track | null | undefined;
    prev?.detach(video);
    this.track?.attach(video);
  }

  ngOnDestroy(): void {
    this.track?.detach(this.el.nativeElement);
  }
}