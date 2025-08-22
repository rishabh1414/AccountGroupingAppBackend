// controllers/customValueController.js
const {
  getSevenFromGhl,
  getSevenFromDbByEntity,
} = require("../services/customValueResolver");

// GET /api/custom-values/location/:locationId  (PUBLIC)
exports.getSevenByLocation = async (req, res, next) => {
  try {
    const { locationId } = req.params;
    const data = await getSevenFromGhl(locationId); // { source, values, flat }
    return res.json({
      locationId,
      source: data.source,
      values: data.flat, // { agencyColor1: "...", ... } – handy for your GHF
      meta: data.values, // original {id,value} map if you need IDs
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/custom-values/:scope(parent|child)/:id?by=id|locationId&fresh=0|1  (PRIVATE)
exports.getSevenByEntity = async (req, res, next) => {
  try {
    const { scope, id } = req.params;
    const by = (req.query.by || "id").toString();
    const fresh = req.query.fresh === "1";

    if (fresh) {
      // read straight from GHL using the entity's locationId
      const {
        getSevenFromGhlForEntity,
      } = require("../services/customValueResolverExtras");
      const data = await getSevenFromGhlForEntity({ scope, id, by });
      return res.json({
        scope,
        id,
        by,
        source: data.source,
        values: data.flat,
        meta: data.values,
      });
    }

    const data = await getSevenFromDbByEntity({ scope, id, by });
    return res.json({
      scope,
      id,
      by,
      source: data.source,
      values: data.flat,
      meta: data.values,
    });
  } catch (err) {
    next(err);
  }
};
