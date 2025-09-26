// Utility functions for geometry and box operations
export function boxIoU(a, b) {
	if (!a || !b) return 0;
	const ax2 = a.x + a.w, ay2 = a.y + a.h;
	const bx2 = b.x + b.w, by2 = b.y + b.h;
	const ix1 = Math.max(a.x, b.x);
	const iy1 = Math.max(a.y, b.y);
	const ix2 = Math.min(ax2, bx2);
	const iy2 = Math.min(ay2, by2);
	const iw = Math.max(0, ix2 - ix1);
	const ih = Math.max(0, iy2 - iy1);
	const inter = iw * ih;
	const union = a.w * a.h + b.w * b.h - inter;
	return union > 0 ? inter / union : 0;
}

export function computeBBox(landmarks) {
	let minX = 1, minY = 1, maxX = 0, maxY = 0;
	for (const p of landmarks) {
		if (p.x < minX) minX = p.x;
		if (p.y < minY) minY = p.y;
		if (p.x > maxX) maxX = p.x;
		if (p.y > maxY) maxY = p.y;
	}
	return { minX, minY, maxX, maxY, area: Math.max(0, maxX - minX) * Math.max(0, maxY - minY) };
}
