import type { GeometryCollection, Topology } from "topojson-specification";
import worldTopo from "world-atlas/countries-110m.json";

/**
 * THE authoritative geometry source for everything the Intel globe draws
 * about the physical/political world: the landmass fill, the country border
 * lines and the country labels are ALL derived from this one Natural Earth
 * 110m topology (world-atlas `countries-110m`, public domain).
 *
 * Why one file matters: the globe used to fill land from one dataset
 * (world-atlas land-110m) and trace borders from a different, differently
 * vintaged one (a bundled three-globe country JSON), so the two never lined
 * up along coastlines, and every shared border was traced twice (once per
 * neighbouring country) at independently decimated point positions. Here
 * land, borders and labels share the same arcs by construction.
 */
export const worldTopology = worldTopo as unknown as Topology;
export const countriesObject = worldTopology.objects.countries as GeometryCollection<{ name?: string }>;
export const landObject = worldTopology.objects.land as GeometryCollection;
