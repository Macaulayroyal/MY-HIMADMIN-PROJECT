// shipping.js - HIM.CLOTHIERS Shipping Management Module
// Uses global variables from dashboard.html: supabaseClient, showLoading, showNotification, getInventoryStatusClass, formatInventoryStatus, getInitials

// Shipping state
let shippingOrders = [];
let shippingRealtimeSubscription = null;

async function renderShipping() {
    const tbody = document.getElementById('shippingTable');
    if (!tbody) return;
    
    tbody.innerHTML = '<tr><td colspan="8" class="text-center">Loading shipping orders...</td></tr>';
    
    try {
        const { data: orders, error } = await supabaseClient
            .from('orders')
            .select('*')
            .in('status', ['paid', 'processing', 'shipped', 'delivered'])
            .in('inventory_status', ['shipping', 'transferring', 'delivered', 'packaging'])
            .order('inventory_updated_at', { ascending: false });
        
        if (error) throw error;
        
        const { data: fallbackOrders, error: fallbackError } = await supabaseClient
            .from('orders')
            .select('*')
            .eq('status', 'shipped')
            .order('updated_at', { ascending: false });
        
        if (fallbackError) throw fallbackError;
        
        const allOrders = [...(orders || []), ...(fallbackOrders || [])];
        shippingOrders = allOrders.filter((order, index, self) => 
            index === self.findIndex((o) => o.id === order.id)
        );
        
        if (shippingOrders.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="text-center">No orders currently in shipping</td></tr>';
            return;
        }
        
        displayShipping(shippingOrders);
        setupShippingRealtimeSubscription();
        
    } catch (error) {
        console.error('Error loading shipping orders:', error);
        tbody.innerHTML = '<tr><td colspan="8" class="text-center" style="color: #dc3545;">Failed to load shipping orders: ' + error.message + '</td></tr>';
    }
}

function displayShipping(orders) {
    const tbody = document.getElementById('shippingTable');
    if (!tbody) return;
    
    if (!orders || orders.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center">No shipping orders found</td></tr>';
        return;
    }
    
    tbody.innerHTML = orders.map(order => {
        const firstItem = order.items && order.items.length > 0 ? order.items[0] : null;
        const itemName = firstItem ? firstItem.name : 'N/A';
        const itemCount = order.items ? order.items.length : 0;
        const displayProduct = itemCount > 1 ? itemName + ' (+' + (itemCount - 1) + ' more)' : itemName;
        
        const shippingAddress = order.shipping_address ? 
            (order.shipping_address.city || '') + ', ' + (order.shipping_address.state || '') : 
            (order.customer_address || 'N/A');
        
        const status = order.inventory_status || 'shipping';
        const statusClass = getInventoryStatusClass(status);
        const statusText = formatInventoryStatus(status);
        
        const trackingNumber = order.tracking_number || '-';
        const carrier = order.shipping_carrier || '-';
        const customerInitials = getInitials(order.customer_name);
        
        return `
            <tr>
                <td><strong style="color: #6F4D38;">${order.id.toString().slice(-8).toUpperCase()}</strong></td>
                <td>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <div class="customer-avatar" style="width: 32px; height: 32px; font-size: 12px; background: linear-gradient(135deg, #6F4D38 0%, #8B6F5C 100%); color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 600;">
                            ${customerInitials}
                        </div>
                        <div>
                            <div style="font-weight: 500;">${order.customer_name || 'Guest'}</div>
                            <small style="color: #6c757d;">${order.customer_phone || ''}</small>
                        </div>
                    </div>
                </td>
                <td>${displayProduct}</td>
                <td style="font-size: 13px; color: #6c757d; max-width: 150px; overflow: hidden; text-overflow: ellipsis;">${shippingAddress}</td>
                <td><span class="status-badge ${statusClass}">${statusText}</span></td>
                <td>
                    <div class="tracking-input" style="display: flex; align-items: center; gap: 8px;">
                        <input type="text" 
                               class="form-input" 
                               style="width: 120px; padding: 6px 10px; font-size: 13px;" 
                               value="${trackingNumber !== '-' ? trackingNumber : ''}" 
                               placeholder="Tracking #"
                               id="tracking-${order.id}"
                               onchange="updateTrackingNumber('${order.id}', this.value)">
                    </div>
                </td>
                <td>
                    <select class="form-select" 
                            style="width: 100px; padding: 6px 10px; font-size: 13px;"
                            onchange="updateShippingCarrier('${order.id}', this.value)"
                            id="carrier-${order.id}">
                        <option value="">Select</option>
                        <option value="DHL" ${carrier === 'DHL' ? 'selected' : ''}>DHL</option>
                        <option value="FedEx" ${carrier === 'FedEx' ? 'selected' : ''}>FedEx</option>
                        <option value="UPS" ${carrier === 'UPS' ? 'selected' : ''}>UPS</option>
                        <option value="USPS" ${carrier === 'USPS' ? 'selected' : ''}>USPS</option>
                        <option value="GIGL" ${carrier === 'GIGL' ? 'selected' : ''}>GIGL</option>
                        <option value="DHL Nigeria" ${carrier === 'DHL Nigeria' ? 'selected' : ''}>DHL Nigeria</option>
                        <option value="Other" ${carrier === 'Other' ? 'selected' : ''}>Other</option>
                    </select>
                </td>
                <td>
                    <div class="action-btns">
                        <button class="action-btn view" onclick="viewShippingDetails('${order.id}')" title="View Details">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                <circle cx="12" cy="12" r="3"></circle>
                            </svg>
                        </button>
                        <button class="action-btn edit" onclick="markAsDelivered('${order.id}')" title="Mark as Delivered" ${status === 'delivered' ? 'disabled style="opacity:0.5;"' : ''}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="20 6 9 17 4 12"></polyline>
                            </svg>
                        </button>
                        <button class="action-btn" onclick="printShippingLabel('${order.id}')" title="Print Label" style="color: #6F4D38;">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="6 9 6 2 18 2 18 9"></polyline>
                                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                                <rect x="6" y="14" width="12" height="8"></rect>
                            </svg>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function filterShipping() {
    const search = document.getElementById('shippingSearch')?.value.toLowerCase() || '';
    const status = document.getElementById('shippingStatusFilter')?.value || '';
    
    let filtered = shippingOrders.filter(order => {
        const matchesSearch = !search || 
            order.id.toString().toLowerCase().includes(search) || 
            (order.customer_name && order.customer_name.toLowerCase().includes(search)) ||
            (order.items && order.items.some(item => item.name.toLowerCase().includes(search))) ||
            (order.tracking_number && order.tracking_number.toLowerCase().includes(search));
        
        const matchesStatus = !status || (order.inventory_status === status || order.status === status);
        
        return matchesSearch && matchesStatus;
    });
    
    displayShipping(filtered);
}

async function updateTrackingNumber(orderId, trackingNumber) {
    if (!trackingNumber.trim()) return;
    
    showLoading(true);
    try {
        const now = new Date().toISOString();
        const { error } = await supabaseClient
            .from('orders')
            .update({ 
                tracking_number: trackingNumber.trim(),
                updated_at: now
            })
            .eq('id', orderId);
        
        if (error) throw error;
        
        const order = shippingOrders.find(o => o.id === orderId);
        if (order) order.tracking_number = trackingNumber.trim();
        
        showNotification('Success', 'Tracking number updated', 'success');
        await notifyCustomerOfTrackingUpdate(orderId, trackingNumber.trim());
        
    } catch (error) {
        console.error('Error updating tracking:', error);
        showNotification('Error', 'Failed to update tracking number', 'error');
    } finally {
        showLoading(false);
    }
}

async function updateShippingCarrier(orderId, carrier) {
    if (!carrier) return;
    
    showLoading(true);
    try {
        const now = new Date().toISOString();
        const { error } = await supabaseClient
            .from('orders')
            .update({ 
                shipping_carrier: carrier,
                updated_at: now
            })
            .eq('id', orderId);
        
        if (error) throw error;
        
        const order = shippingOrders.find(o => o.id === orderId);
        if (order) order.shipping_carrier = carrier;
        
        showNotification('Success', 'Carrier updated to ' + carrier, 'success');
        
    } catch (error) {
        console.error('Error updating carrier:', error);
        showNotification('Error', 'Failed to update carrier', 'error');
    } finally {
        showLoading(false);
    }
}

async function markAsDelivered(orderId) {
    if (!confirm('Are you sure you want to mark this order as DELIVERED?')) return;
    
    showLoading(true);
    try {
        const now = new Date().toISOString();
        
        const { data: currentOrder, error: checkError } = await supabaseClient
            .from('orders')
            .select('customer_email, customer_name, user_id, guest_session_id')
            .eq('id', orderId)
            .single();
            
        if (checkError) throw checkError;
        
        const { error } = await supabaseClient
            .from('orders')
            .update({ 
                status: 'delivered',
                inventory_status: 'delivered',
                delivered_at: now,
                inventory_updated_at: now,
                updated_at: now
            })
            .eq('id', orderId);
        
        if (error) throw error;
        
        const notificationData = {
            type: 'delivered',
            title: 'Order Delivered!',
            message: 'Dear ' + (currentOrder.customer_name || 'Customer') + ', your order #' + orderId.toString().slice(-8).toUpperCase() + ' has been delivered. Thank you for shopping with HIM.CLOTHIERS!',
            order_id: orderId,
            is_read: false,
            created_at: now
        };
        
        if (currentOrder.customer_email) {
            notificationData.customer_email = currentOrder.customer_email;
            notificationData.user_email = currentOrder.customer_email;
        }
        if (currentOrder.user_id) notificationData.user_id = currentOrder.user_id;
        if (currentOrder.guest_session_id) notificationData.guest_session_id = currentOrder.guest_session_id;
        
        supabaseClient.from('notifications').insert(notificationData).then(({ error }) => {
            if (error) console.log('Notification warning:', error.message);
        });
        
        showNotification('Success', 'Order marked as delivered', 'success');
        setTimeout(() => renderShipping(), 500);
        
    } catch (error) {
        console.error('Error marking as delivered:', error);
        showNotification('Error', 'Failed to update delivery status', 'error');
    } finally {
        showLoading(false);
    }
}

async function notifyCustomerOfTrackingUpdate(orderId, trackingNumber) {
    try {
        const { data: order, error } = await supabaseClient
            .from('orders')
            .select('customer_email, customer_name, user_id, guest_session_id, shipping_carrier')
            .eq('id', orderId)
            .single();
            
        if (error || !order) return;
        
        const carrier = order.shipping_carrier || 'the carrier';
        const now = new Date().toISOString();
        
        const notificationData = {
            type: 'tracking_update',
            title: 'Tracking Information Available',
            message: 'Dear ' + (order.customer_name || 'Customer') + ', your order #' + orderId.toString().slice(-8).toUpperCase() + ' is now shipping with ' + carrier + '. Tracking number: ' + trackingNumber,
            order_id: orderId,
            is_read: false,
            created_at: now
        };
        
        if (order.customer_email) {
            notificationData.customer_email = order.customer_email;
            notificationData.user_email = order.customer_email;
        }
        if (order.user_id) notificationData.user_id = order.user_id;
        if (order.guest_session_id) notificationData.guest_session_id = order.guest_session_id;
        
        await supabaseClient.from('notifications').insert(notificationData);
        
    } catch (error) {
        console.log('Tracking notification error (non-critical):', error.message);
    }
}

function viewShippingDetails(orderId) {
    const order = shippingOrders.find(o => o.id === orderId);
    if (!order) return;
    
    const placeholderImg = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCI+PHJlY3QgZmlsbD0iI2Y5ZjVmMiIgd2lkdGg9IjYwIiBoZWlnaHQ9IjYwIi8+PHRleHQgZmlsbD0iIzZGNEMzOCIgeD0iMzAiIHk9IjM1IiBmb250LXNpemU9IjIwIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj7ilqM8L3RleHQ+PC9zdmc+';
    
    const itemsHtml = order.items?.map((item) => {
        const imageUrl = item.image && (item.image.startsWith('http') || item.image.startsWith('data:')) ? item.image : placeholderImg;
        return `
        <div style="display: flex; gap: 12px; padding: 12px; background: #f8f9fa; border-radius: 8px; margin-bottom: 8px;">
            <img src="${imageUrl}" alt="${item.name}" style="width: 60px; height: 60px; object-fit: cover; border-radius: 6px; border: 1px solid #e0e0e0;" onerror="this.src='${placeholderImg}'">
            <div style="flex: 1;">
                <div style="font-weight: 600;">${item.name}</div>
                <div style="font-size: 13px; color: #6c757d;">Qty: ${item.quantity}${item.size ? ' | Size: ' + item.size : ''}${item.color ? ' | Color: ' + item.color : ''}</div>
                <div style="font-weight: 500; color: #6F4D38;">₦${parseFloat(item.price).toLocaleString()} each</div>
            </div>
        </div>
    `}).join('') || '<p style="color: #6c757d;">No items found</p>';
    
    const shippingAddressHtml = order.shipping_address ? `
        <div style="background: #f8f9fa; padding: 16px; border-radius: 8px; margin-bottom: 16px;">
            <div style="font-size: 12px; color: #6c757d; text-transform: uppercase; margin-bottom: 8px;">Shipping Address</div>
            <div style="font-weight: 500;">${order.shipping_address.full_name || order.customer_name || 'N/A'}</div>
            <div>${order.shipping_address.address || 'N/A'}</div>
            ${order.shipping_address.apartment ? '<div>' + order.shipping_address.apartment + '</div>' : ''}
            <div>${order.shipping_address.city || ''}, ${order.shipping_address.state || ''} ${order.shipping_address.postal_code || ''}</div>
            <div>${order.shipping_address.country || 'Nigeria'}</div>
            <div style="margin-top: 8px; color: #6c757d; font-size: 13px;">📞 ${order.shipping_address.phone || order.customer_phone || 'N/A'}</div>
        </div>
    ` : `
        <div style="background: #f8f9fa; padding: 16px; border-radius: 8px; margin-bottom: 16px;">
            <div style="font-size: 12px; color: #6c757d; text-transform: uppercase; margin-bottom: 8px;">Shipping Address</div>
            <div style="color: #6c757d;">${order.customer_address || 'No address provided'}</div>
        </div>
    `;
    
    const trackingInfoHtml = order.tracking_number ? `
        <div style="background: #e8f5e9; padding: 16px; border-radius: 8px; margin-bottom: 16px; border-left: 4px solid #28a745;">
            <div style="font-size: 12px; color: #28a745; text-transform: uppercase; margin-bottom: 8px;">Tracking Information</div>
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <div style="font-weight: 600; font-size: 16px;">${order.tracking_number}</div>
                    <div style="color: #6c757d; font-size: 13px;">Carrier: ${order.shipping_carrier || 'Not specified'}</div>
                </div>
                <a href="${getCarrierTrackingUrl(order.shipping_carrier, order.tracking_number)}" 
                   target="_blank" 
                   class="btn btn-primary btn-sm"
                   style="text-decoration: none;">
                    Track Package
                </a>
            </div>
        </div>
    ` : '';
    
    const modalHtml = `
        <div class="modal-overlay active" id="shippingDetailsModal" onclick="if(event.target===this)closeShippingDetails()">
            <div class="modal" style="max-width: 600px; max-height: 90vh; overflow-y: auto;">
                <div class="modal-header">
                    <h3 class="modal-title">Shipping Details - ${order.id.toString().slice(-8).toUpperCase()}</h3>
                    <button class="modal-close" onclick="closeShippingDetails()">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <div class="modal-body">
                    <div style="margin-bottom: 20px;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 16px;">
                            <div>
                                <div style="font-size: 12px; color: #6c757d; text-transform: uppercase;">Customer</div>
                                <div style="font-weight: 600; font-size: 16px;">${order.customer_name || 'Guest'}</div>
                                <div style="font-size: 13px; color: #6c757d;">${order.customer_email || ''}</div>
                                <div style="font-size: 13px; color: #6c757d;">📞 ${order.customer_phone || 'N/A'}</div>
                            </div>
                            <div style="text-align: right;">
                                <div style="font-size: 12px; color: #6c757d; text-transform: uppercase;">Order Date</div>
                                <div style="font-weight: 500;">${new Date(order.created_at).toLocaleDateString('en-NG')}</div>
                                <div style="margin-top: 8px; font-size: 12px; color: #6c757d; text-transform: uppercase;">Status</div>
                                <span class="status-badge ${getInventoryStatusClass(order.inventory_status || 'shipping')}">
                                    ${formatInventoryStatus(order.inventory_status || 'shipping')}
                                </span>
                            </div>
                        </div>
                    </div>
                    
                    ${shippingAddressHtml}
                    ${trackingInfoHtml}
                    
                    <div style="margin-bottom: 20px;">
                        <div style="font-size: 12px; color: #6c757d; text-transform: uppercase; margin-bottom: 12px;">Items</div>
                        ${itemsHtml}
                    </div>
                    
                    <div style="background: #f8f9fa; padding: 16px; border-radius: 8px;">
                        <div style="display: flex; justify-content: space-between; padding-top: 12px; border-top: 1px solid #dee2e6;">
                            <span style="font-weight: 600;">Total Amount</span>
                            <span style="font-weight: 700; color: #6F4D38; font-size: 18px;">₦${parseFloat(order.total_amount).toLocaleString()}</span>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="closeShippingDetails()">Close</button>
                    ${order.inventory_status !== 'delivered' ? `
                        <button class="btn btn-success" onclick="markAsDelivered('${order.id}'); closeShippingDetails();">Mark as Delivered</button>
                    ` : ''}
                </div>
            </div>
        </div>
    `;
    
    const existingModal = document.getElementById('shippingDetailsModal');
    if (existingModal) existingModal.remove();
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    document.body.style.overflow = 'hidden';
}

function closeShippingDetails() {
    const modal = document.getElementById('shippingDetailsModal');
    if (modal) {
        modal.remove();
        document.body.style.overflow = '';
    }
}

function getCarrierTrackingUrl(carrier, trackingNumber) {
    const carrierUrls = {
        'DHL': 'https://www.dhl.com/en/express/tracking.html?AWB=' + trackingNumber + '&brand=DHL',
        'FedEx': 'https://www.fedex.com/apps/fedextrack/?tracknumbers=' + trackingNumber,
        'UPS': 'https://www.ups.com/track?tracknum=' + trackingNumber,
        'USPS': 'https://tools.usps.com/go/TrackConfirmAction?tLabels=' + trackingNumber,
        'GIGL': 'https://giglogistics.com/track/?tracking_id=' + trackingNumber,
        'DHL Nigeria': 'https://www.dhl.com/en/express/tracking.html?AWB=' + trackingNumber + '&brand=DHL'
    };
    return carrierUrls[carrier] || '#';
}

function printShippingLabel(orderId) {
    const order = shippingOrders.find(o => o.id === orderId);
    if (!order) return;
    
    const labelHtml = `
        <html>
        <head>
            <title>Shipping Label - ${order.id}</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
                .label { border: 2px solid #000; padding: 20px; max-width: 400px; margin: 0 auto; }
                .header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 20px; }
                .brand { font-size: 24px; font-weight: bold; color: #6F4D38; letter-spacing: 2px; }
                .section { margin-bottom: 15px; }
                .label-title { font-size: 10px; text-transform: uppercase; color: #666; margin-bottom: 4px; }
                .label-value { font-size: 14px; font-weight: bold; }
                .barcode { text-align: center; margin: 20px 0; padding: 10px; background: #f0f0f0; font-family: monospace; font-size: 20px; letter-spacing: 4px; }
                .footer { text-align: center; font-size: 12px; margin-top: 20px; padding-top: 10px; border-top: 1px solid #ccc; }
            </style>
        </head>
        <body>
            <div class="label">
                <div class="header">
                    <div class="brand">HIM.CLOTHIERS</div>
                    <div style="font-size: 12px; margin-top: 5px;">SHIPPING LABEL</div>
                </div>
                
                <div class="section">
                    <div class="label-title">SHIP TO:</div>
                    <div class="label-value">${order.customer_name || 'Guest'}</div>
                    <div>${order.shipping_address?.address || order.customer_address || 'N/A'}</div>
                    <div>${order.shipping_address?.city || ''}, ${order.shipping_address?.state || ''}</div>
                    <div>📞 ${order.customer_phone || 'N/A'}</div>
                </div>
                
                <div class="section">
                    <div class="label-title">ORDER ID:</div>
                    <div class="barcode">*${order.id.toString().slice(-8).toUpperCase()}*</div>
                </div>
                
                <div class="section">
                    <div class="label-title">TRACKING:</div>
                    <div class="label-value">${order.tracking_number || 'N/A'}</div>
                    <div>${order.shipping_carrier || 'N/A'}</div>
                </div>
                
                <div class="footer">
                    <div>Order Date: ${new Date(order.created_at).toLocaleDateString('en-NG')}</div>
                    <div>Thank you for shopping with us!</div>
                </div>
            </div>
            
            <script>
                window.onload = function() { window.print(); }
            </script>
        </body>
        </html>
    `;
    
    const printWindow = window.open('', '_blank');
    printWindow.document.write(labelHtml);
    printWindow.document.close();
}

function setupShippingRealtimeSubscription() {
    if (shippingRealtimeSubscription) {
        supabaseClient.removeChannel(shippingRealtimeSubscription);
    }
    
    shippingRealtimeSubscription = supabaseClient
        .channel('shipping-orders-' + Date.now())
        .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'orders'
        }, (payload) => {
            console.log('Order updated via realtime (shipping):', payload);
            const updatedOrder = payload.new;
            if (['paid', 'processing', 'shipped', 'delivered'].includes(updatedOrder.status) ||
                ['packaging', 'shipping', 'transferring', 'delivered'].includes(updatedOrder.inventory_status)) {
                setTimeout(() => renderShipping(), 1000);
            }
        })
        .subscribe();
} 