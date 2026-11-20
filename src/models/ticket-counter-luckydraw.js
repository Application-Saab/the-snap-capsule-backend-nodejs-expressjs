// Define the TicketCounter model
const mongoose = require('mongoose');

const ticketCounterSchema = new mongoose.Schema({
  _id: { type: String, default: "luckyDrawCounter" }, // Single document to store the counter
  sequenceValue: { type: Number, default: 1621 }, // Starting value is 1621, so +1 gives 1622
});

// const TicketCounter = mongoose.model("TicketCounter", ticketCounterSchema);
module.exports = mongoose.model('TicketCounter', ticketCounterSchema);