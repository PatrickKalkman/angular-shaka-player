import { Component, Input, ElementRef, ViewChild, 
  AfterViewInit, OnChanges, SimpleChanges, Output, EventEmitter } from '@angular/core';
import { Store, Select } from '@ngxs/store';
//import * as shaka from '../../../../node_modules/shaka-player/dist/shaka-player.js';
//import * as shaka from 'shaka-player';
import { throwError, fromEvent, Observable, merge } from 'rxjs';
import { distinctUntilChanged, map } from 'rxjs/operators';
import { get } from 'lodash';
import { Platform } from '@angular/cdk/platform';

declare let shaka: any;
declare let $: any;

@Component({
  selector: 'app-shaka-player',
  templateUrl: './shaka-player.component.html',
  styleUrls: ['./shaka-player.component.scss'],
})
export class ShakaPlayerComponent implements AfterViewInit, OnChanges {
  @ViewChild('videoPlayer') videoElementRef: ElementRef;
  @ViewChild('videoContainer') videoContainerRef: ElementRef;

  @Input() posterUrl: string | null = null;
  @Input() dashManifestUrl: string | null = null;
  @Input() keyId: string | null = null;
  @Input() currentTime: string;
  @Input() width = '854';
  @Input() height = '480';
  @Input() autoPlay = false;
  @Input() muted = false;
  @Input() triggeredEvents: string[] = [];

  @Output() videoLoaded = new EventEmitter<any>();
  @Output() videoLoadError = new EventEmitter<any>();
  @Output() videoTimeUpdated = new EventEmitter<any>();
  @Output() playerEvents = new EventEmitter<any>();

  videoElement: HTMLVideoElement;
  videoContainerElement: HTMLDivElement;
  player: any;

  constructor(private store: Store, private platform: Platform) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (this.player && changes.dashManifestUrl) {
      this.player.unload();
      this.load();
    }
    if (this.player && changes.currentTime) {
      this.player.getMediaElement().currentTime = changes.currentTime.currentValue;
    }
  }

  public load() {
    this.player
      .load(this.dashManifestUrl)
      .then(() => {
        const textTracks = this.player.getTextTracks();
        if (textTracks.length > 0) {
          this.player.setTextTrackVisibility(true);
          this.player.selectTextTrack(textTracks[0]);
        }
        this.videoElement.play();
        this.videoLoaded.emit();
      })
      .catch((e) => {
        this.videoLoadError.emit(e);
      });
  }

  fromEvents(video: HTMLVideoElement, events: string[]): Observable<Event> {
    const eventStreams = events.map((ev) => fromEvent(video, ev));
    return merge(...eventStreams);
  }

  onClick() {
    console.log(this.player.ui);
  }

  ngAfterViewInit(): void {
    shaka.polyfill.installAll();

    // Check to see if the browser supports the basic APIs Shaka needs.
    if (shaka.Player.isBrowserSupported()) {
      // Everything looks good!
      this.videoElement = this.videoElementRef.nativeElement;
      this.videoContainerElement = this.videoContainerRef.nativeElement;
      this.initPlayer();
    } else {
      // This browser does not have the minimum set of APIs we need.
      throwError('Browser not supported!');
    }
  }

  private initPlayer() {

    const events = [
      ...this.triggeredEvents,
      'pause',
      'play',
      'canplay',
      'playing',
      'waiting',
      'ended',
      'seeked',
      'enterpictureinpicture',
      'leavepictureinpicture',
    ];
    //add events Listener to HTML video element
    this.fromEvents(this.videoElement, events)
      .pipe(distinctUntilChanged())
      .subscribe((evt: Event) => {
        this.playerEvents.emit(evt);
      });

    // Create a Player instance.
    this.player = new shaka.Player(this.videoElement);

    const ui = new shaka.ui.Overlay(this.player, this.videoContainerElement, this.videoElement);

    const config = {
      seekBarColors: {
        base: 'rgba(255,255,255,.2)',
        buffered: 'rgba(255,255,255,.4)',
        played: 'rgb(255,0,0)',
      },
    };

    ui.configure(config);

    const cert = get(this.store.snapshot(), ['app', 'fairplayCertificate'], new ArrayBuffer(0));

    if (this.platform.SAFARI) {
      this.player.configure({
        preferredAudioLanguage: 'en-US',
        drm: {
          servers: {
            'com.apple.fps.1_0': `https://encoding.simpletechture.nl/drm/?id=${this.keyId}`,
          },
          advanced: {
            'com.apple.fps.1_0': {
              serverCertificate: new Uint8Array(cert),
            },
          },
        },
      });
    } else {
      this.player.configure({
        drm: {
          servers: {
            'com.widevine.alpha': `https://encoding.simpletechture.nl/drm/?id=${this.keyId}`,
          },
          advanced: {
            'com.widevine.alpha': {
              videoRobustness: 'SW_SECURE_CRYPTO',
              audioRobustness: 'SW_SECURE_CRYPTO',
            },
          },
        },
      });
    }

    $('.shaka-overflow-menu-button').html('settings');
    $('.shaka-back-to-overflow-button .material-icons-round').html('arrow_back_ios_new');

    if (this.platform.SAFARI) {
      this.player.getNetworkingEngine().registerRequestFilter((type, request) => {
        if (type !== shaka.net.NetworkingEngine.RequestType.LICENSE) {
          return;
        }

        const originalPayload = new Uint8Array(request.body);
        const base64Payload = shaka.util.Uint8ArrayUtils.toStandardBase64(originalPayload);

        request.headers['Content-Type'] = 'application/x-www-form-urlencoded';
        request.body = shaka.util.StringUtils.toUTF8('spc=' + base64Payload);
      });

      this.player.getNetworkingEngine().registerResponseFilter((type, response) => {
        if (type !== shaka.net.NetworkingEngine.RequestType.LICENSE) {
          return;
        }

        let responseText = shaka.util.StringUtils.fromUTF8(response.data);
        // Trim whitespace.
        responseText = responseText.trim();

        // Look for <ckc> wrapper and remove it.
        if (responseText.substr(0, 5) === '<ckc>' && responseText.substr(-6) === '</ckc>') {
          responseText = responseText.slice(5, -6);
        }

        // Decode the base64-encoded data into the format the browser expects.
        response.data = shaka.util.Uint8ArrayUtils.fromBase64(responseText).buffer;
      });
    }

    this.load();
    console.log(this.currentTime);
    if (this.currentTime) {
      this.player.getMediaElement().currentTime = parseInt(this.currentTime, 10);
    }
  }
}
