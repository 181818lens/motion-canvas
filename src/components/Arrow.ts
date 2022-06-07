import {Shape, ShapeConfig} from 'konva/lib/Shape';
import {_registerNode} from 'konva/lib/Global';
import {Context} from 'konva/lib/Context';
import {GetSet, Vector2d} from 'konva/lib/types';
import {Factory} from 'konva/lib/Factory';
import {
  getNumberArrayValidator,
  getNumberValidator,
} from 'konva/lib/Validators';

export interface ArrowConfig extends ShapeConfig {
  radius?: number;
  points?: number[];
  startArrow?: boolean;
  start?: number;
  endArrow?: boolean;
  arrowSize?: number;
  end?: number;
}

abstract class Segment {
  public abstract draw(
    context: Context,
    start: number,
    end: number,
    move: boolean,
  ): [Vector2d, Vector2d, Vector2d, Vector2d];

  public abstract get arcLength(): number;

  public getOffset(from: number): number {
    return 0;
  }
}

class LineSegment extends Segment {
  private readonly length: number;
  private readonly vector: Vector2d;
  private readonly tangent: Vector2d;

  public constructor(private from: Vector2d, private to: Vector2d) {
    super();
    this.vector = {
      x: this.to.x - this.from.x,
      y: this.to.y - this.from.y,
    };
    this.length = Math.sqrt(
      this.vector.x * this.vector.x + this.vector.y * this.vector.y,
    );
    this.tangent = {
      x: -this.vector.y / this.length,
      y: this.vector.x / this.length,
    };
  }

  get arcLength(): number {
    return this.length;
  }

  public draw(
    context: Context,
    start: number = 0,
    end: number = 1,
    move: boolean = false,
  ): [Vector2d, Vector2d, Vector2d, Vector2d] {
    const from = {
      x: this.from.x + this.vector.x * start,
      y: this.from.y + this.vector.y * start,
    };
    const to = {
      x: this.from.x + this.vector.x * end,
      y: this.from.y + this.vector.y * end,
    };
    if (move) context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);

    return [
      from,
      {
        x: -this.tangent.x,
        y: -this.tangent.y,
      },
      to,
      this.tangent,
    ];
  }
}

class CircleSegment extends Segment {
  private readonly length: number;

  public constructor(
    private center: Vector2d,
    private radius: number,
    private startAngle: number,
    private deltaAngle: number,
    private counter: boolean,
  ) {
    super();
    this.length = Math.abs(deltaAngle * radius);
  }

  get arcLength(): number {
    return this.length;
  }

  draw(
    context: Context,
    from: number,
    to: number,
    move: boolean,
  ): [Vector2d, Vector2d, Vector2d, Vector2d] {
    const delta = this.counter
      ? this.deltaAngle
      : this.deltaAngle + Math.PI * 2;

    const startAngle = this.startAngle + delta * from;
    const endAngle = this.startAngle + delta * to;

    context.arc(
      this.center.x,
      this.center.y,
      this.radius,
      startAngle,
      endAngle,
      this.counter,
    );

    const startTangent = {
      x: Math.cos(startAngle),
      y: Math.sin(startAngle),
    };
    const endTangent = {
      x: Math.cos(endAngle),
      y: Math.sin(endAngle),
    };

    return [
      {
        x: this.center.x + this.radius * startTangent.x,
        y: this.center.y + this.radius * startTangent.y,
      },
      this.counter
        ? {
            x: -startTangent.x,
            y: -startTangent.y,
          }
        : startTangent,
      {
        x: this.center.x + this.radius * endTangent.x,
        y: this.center.y + this.radius * endTangent.y,
      },
      this.counter
        ? endTangent
        : {
            x: -endTangent.x,
            y: -endTangent.y,
          },
    ];
  }

  public getOffset(from: number): number {
    return this.counter ? 0 : -from * 1.045 * this.deltaAngle * this.radius / 2;
  }
}

export class Arrow extends Shape<ArrowConfig> {
  private segments: Segment[] = [];
  private arcLength: number = 0;
  private dirty = true;

  _sceneFunc(context: Context) {
    if (this.dirty) {
      this.calculatePath();
      this.dirty = false;
    }

    let start = (this.attrs.start ?? 0) * this.arcLength;
    let end = (this.attrs.end ?? 1) * this.arcLength;
    if (start > end) {
      [start, end] = [end, start];
    }
    let offset = start;

    const distance = end - start;
    const arrowSize = this.attrs.arrowSize || 0;
    const arrowScale =
      (distance > arrowSize ? arrowSize : distance < 0 ? 0 : distance) /
      arrowSize;

    context.beginPath();
    let length = 0;
    let firstPoint = null;
    let firstTangent = null;
    let lastPoint = null;
    let lastTangent = null;
    for (const segment of this.segments) {
      length += segment.arcLength;
      const relativeStart =
        (start - length + segment.arcLength) / segment.arcLength;
      const relativeEnd =
        (end - length + segment.arcLength) / segment.arcLength;

      const clampedStart =
        relativeStart > 1 ? 1 : relativeStart < 0 ? 0 : relativeStart;
      const clampedEnd =
        relativeEnd > 1 ? 1 : relativeEnd < 0 ? 0 : relativeEnd;

      if (length < start) {
        offset -= segment.getOffset(clampedStart);
        continue;
      }

      const [first, fTangent, last, lTangent] = segment.draw(
        context,
        clampedStart,
        clampedEnd,
        firstPoint === null,
      );
      offset -= segment.getOffset(clampedStart);

      if (firstPoint === null) {
        firstPoint = first;
        firstTangent = fTangent;
      }

      lastPoint = last;
      lastTangent = lTangent;
      if (length > end) {
        break;
      }
    }
    this.dashOffset(offset);
    context.strokeShape(this);
    context.beginPath();

    if (this.attrs.endArrow && lastPoint && arrowScale > 0.0001) {
      this.drawArrow(context, lastPoint, lastTangent, arrowScale);
    }

    if (this.attrs.startArrow && firstPoint && arrowScale > 0.0001) {
      this.drawArrow(context, firstPoint, firstTangent, arrowScale);
    }

    context.fillShape(this);
  }

  private drawArrow(
    context: Context,
    center: Vector2d,
    tangent: Vector2d,
    size: number,
  ) {
    const arrowSize = (this.attrs.arrowSize || 0) * size;
    const offset = this.strokeWidth() / 2;
    const normal = {
      x: -tangent.y,
      y: tangent.x,
    };

    center.x -= normal.x * offset * size;
    center.y -= normal.y * offset * size;

    context.moveTo(center.x, center.y);
    context.lineTo(
      center.x + (normal.x + tangent.x) * arrowSize,
      center.y + (normal.y + tangent.y) * arrowSize,
    );
    context.lineTo(
      center.x + (normal.x - tangent.x) * arrowSize,
      center.y + (normal.y - tangent.y) * arrowSize,
    );
    context.lineTo(center.x, center.y);
    context.closePath();
  }

  private calculatePath() {
    if (!this.attrs.points || !this.attrs.radius) return;
    this.arcLength = 0;
    this.segments = [];

    const points: number[] = this.attrs.points;
    const radius = this.attrs.radius || 0;

    let lastX = points[0];
    let lastY = points[1];
    for (let i = 5; i < points.length; i += 2) {
      const startX = points[i - 5];
      const startY = points[i - 4];
      const centerX = points[i - 3];
      const centerY = points[i - 2];
      const endX = points[i - 1];
      const endY = points[i];

      const toStartX = startX - centerX;
      const toStartY = startY - centerY;
      const toEndX = endX - centerX;
      const toEndY = endY - centerY;

      const correctAngle = Math.atan2(
        toEndY * toStartX - toEndX * toStartY,
        toEndX * toStartX + toEndY * toStartY,
      );
      const startAngle = Math.atan2(-toStartY, toStartX);
      const endAngle = Math.atan2(-toEndY, toEndX);
      const angle = startAngle - correctAngle / 2;

      const length = radius / Math.abs(Math.sin(correctAngle / 2));
      const circleX = length * Math.cos(angle);
      const circleY = length * -Math.sin(angle);

      const deltaLength = radius / Math.abs(Math.tan(correctAngle / 2));
      const startDeltaX = deltaLength * Math.cos(startAngle);
      const startDeltaY = deltaLength * -Math.sin(startAngle);

      const endDeltaX = deltaLength * Math.cos(endAngle);
      const endDeltaY = deltaLength * -Math.sin(endAngle);

      const start = {x: centerX + startDeltaX, y: centerY + startDeltaY};
      const center = {x: centerX + circleX, y: centerY + circleY};
      const centerToStart = {x: start.x - center.x, y: start.y - center.y};
      const perpendicularAngle = -Math.atan2(-centerToStart.y, centerToStart.x);

      const line = new LineSegment({x: lastX, y: lastY}, start);
      const circle = new CircleSegment(
        center,
        radius,
        perpendicularAngle,
        correctAngle - Math.PI,
        correctAngle > 0,
      );

      this.segments.push(line);
      this.segments.push(circle);

      this.arcLength += line.arcLength;
      this.arcLength += circle.arcLength;

      lastX = centerX + endDeltaX;
      lastY = centerY + endDeltaY;
    }

    const line = new LineSegment(
      {x: lastX, y: lastY},
      {x: points[points.length - 2], y: points[points.length - 1]},
    );
    this.segments.push(line);
    this.arcLength += line.arcLength;
  }

  public markAsDirty() {
    this.dirty = true;
  }

  getWidth() {
    const points = (<number[]>this.attrs.points || [0, 0]).filter(
      (value, index) => index % 2 === 1,
    );
    return Math.max(...points) - Math.min(...points);
  }
  getHeight() {
    const points = (<number[]>this.attrs.points || [0, 0]).filter(
      (value, index) => index % 2 === 0,
    );
    return Math.max(...points) - Math.min(...points);
  }

  radius: GetSet<number, this>;
  points: GetSet<number[], this>;
  start: GetSet<number, this>;
  end: GetSet<number, this>;
}

Arrow.prototype.className = 'Arrow';
Arrow.prototype._attrsAffectingSize = ['points', 'radius'];

_registerNode(Arrow);

Factory.addGetterSetter(
  Arrow,
  'radius',
  0,
  getNumberValidator(),
  Arrow.prototype.markAsDirty,
);
Factory.addGetterSetter(
  Arrow,
  'points',
  [],
  getNumberArrayValidator(),
  Arrow.prototype.markAsDirty,
);
Factory.addGetterSetter(Arrow, 'start', 0, getNumberValidator());
Factory.addGetterSetter(Arrow, 'end', 1, getNumberValidator());
