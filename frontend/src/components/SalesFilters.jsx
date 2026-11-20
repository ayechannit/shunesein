import React, { useEffect, useMemo, useState } from 'react';
import { SearchableSelect } from './masterData/MasterDataPrimitives';
import { fetchTrips } from '../services/routeService';
import { formatDate } from '../utils/datetime';

// Shared From / To / Customer / Warehouse / Route Trip filters for the Sale
// Orders and Sales Invoices lists and the sales reports. Dates stay plain
// YYYY-MM-DD strings from <input type="date"> - never converted to a JS Date.

export const emptySalesFilters = () => ({ from: '', to: '', customer_id: '', warehouse_id: '', route_trip_id: '', salesperson_id: '' });

export const hasSalesFilters = (filters) => Object.values(filters).some(Boolean);

// Every route trip (open and settled), newest first. A user without access
// to route trips just gets an empty list and the filter is hidden.
export const useRouteTripOptions = (token) => {
  const [trips, setTrips] = useState([]);
  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;
    fetchTrips(token, { limit: '1000', sortBy: 'trip_date', order: 'DESC' })
      .then((response) => { if (!cancelled) setTrips(response.data || []); })
      .catch(() => { if (!cancelled) setTrips([]); });
    return () => { cancelled = true; };
  }, [token]);
  return useMemo(() => trips.map((trip) => ({
    value: String(trip.id),
    label: `${trip.trip_number} - ${trip.vehicle_name || 'vehicle'}${trip.trip_date ? ` (${formatDate(trip.trip_date)})` : ''}`,
  })), [trips]);
};

export const SalesFilterFields = ({
  values,
  onChange,
  customers = [],
  warehouses = [],
  tripOptions = [],
  salespeople = [],
  showDates = true,
  showWarehouse = true,
  showRouteTrip = true,
  showSalesperson = false,
}) => {
  const customerOptions = useMemo(
    () => customers.map((c) => ({ value: String(c.id), label: c.phone ? `${c.name} (${c.phone})` : c.name })),
    [customers],
  );
  const warehouseOptions = useMemo(
    () => warehouses.map((w) => ({ value: String(w.id), label: w.name })),
    [warehouses],
  );
  const salespersonOptions = useMemo(
    () => salespeople.map((u) => ({ value: String(u.id), label: u.full_name || u.username })),
    [salespeople],
  );

  return (
    <>
      {showDates ? (
        <>
          <div className="form-field sales-filter-field sales-filter-date">
            <label>From</label>
            <input type="date" value={values.from} max={values.to || undefined} onChange={(e) => onChange('from', e.target.value)} />
          </div>
          <div className="form-field sales-filter-field sales-filter-date">
            <label>To</label>
            <input type="date" value={values.to} min={values.from || undefined} onChange={(e) => onChange('to', e.target.value)} />
          </div>
        </>
      ) : null}
      <div className="form-field sales-filter-field">
        <label>Customer</label>
        <SearchableSelect value={values.customer_id} onChange={(v) => onChange('customer_id', v)} options={customerOptions} placeholder="All customers" searchPlaceholder="Search name or phone..." allowEmpty />
      </div>
      {showWarehouse ? (
        <div className="form-field sales-filter-field">
          <label>Warehouse</label>
          <SearchableSelect value={values.warehouse_id} onChange={(v) => onChange('warehouse_id', v)} options={warehouseOptions} placeholder="All warehouses" searchPlaceholder="Search warehouses..." allowEmpty />
        </div>
      ) : null}
      {showSalesperson ? (
        <div className="form-field sales-filter-field">
          <label>Salesperson</label>
          <SearchableSelect value={values.salesperson_id} onChange={(v) => onChange('salesperson_id', v)} options={salespersonOptions} placeholder="All salespeople" searchPlaceholder="Search salespeople..." allowEmpty />
        </div>
      ) : null}
      {showRouteTrip && tripOptions.length > 0 ? (
        <div className="form-field sales-filter-field">
          <label>Route Trip</label>
          <SearchableSelect value={values.route_trip_id} onChange={(v) => onChange('route_trip_id', v)} options={tripOptions} placeholder="All trips" searchPlaceholder="Search trips..." allowEmpty />
        </div>
      ) : null}
    </>
  );
};
